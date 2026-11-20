import type { Asset } from "../assets/assets";
import { constantAt, type EnumDocument, groupConstants, liveEdges } from "../enums";
import { type GraphEdge, ROOT_ID } from "../graph/document";
import type { GraphNode, HydratedGraphDocument } from "../graph/document";
import type { GraphModel } from "../graph/model";
import {
	MEDIA_NODE_TYPES,
	SAMPLE_TEXTURE,
	TEXTURE_SIZE,
	textureCoordinates,
} from "../nodes/texture";
import {
	packState,
	simulationId,
	type SimulationRef,
	type StateItem,
	texelType,
	unpackState,
} from "../passes/simulation";
import {
	readSource,
	type SocketRef,
	sourceFormat,
	sourceSize,
	stateSource,
	type TextureSource,
	TextureSources,
} from "../passes/sources";
import { CANVAS_SIZE, sameSize, type TextureFormat, type TextureSize } from "../passes/textures";
import type {
	GroupHandleDef,
	InputValue,
	NodeData,
	SamplerAddress,
	SamplerFilter,
	SocketType,
	TypeBindings,
	WgslType,
	ZoneItem,
} from "../types";
import {
	boundType,
	completeBindings,
	convertVar,
	inputControl,
	inputDefaultType,
	isTexture,
	isUniformControl,
	makeType,
	typeComponents,
	unavailableEdges,
	valueType,
	valueTypes,
	WGSL_DEFAULTS,
	wgslTypeName,
} from "../types";
import {
	analyzeZones,
	DEFAULT_ITERATIONS,
	DELTA_TIME_HANDLE,
	ITERATION_HANDLE,
	ITERATIONS_HANDLE,
	pairedOutputId,
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	simulatingDefinitions,
	SIMULATION_INPUT,
	SIMULATION_OUTPUT,
	SKIP_HANDLE,
	type Zone,
	type ZoneAnalysis,
	zoneItems,
	zoneMaxIterations,
} from "../zones";
import { HelperRegistry } from "./helpers";
import {
	formatWgslLiteral,
	identSuffix,
	uniformName,
	type UniformValue,
	uniformValue,
} from "./literals";
import {
	FRAGMENT_VAR,
	FRAME_VAR,
	type SamplerBinding,
	SIMULATION_DELTA_FIELD,
	TARGETS_STRUCT,
	type TextureBinding,
	UNIFORMS_VAR,
} from "./program";
import { readTexture, texelAsColor } from "./texture-read";

// ── Graph walking ────────────────────────────────────────────────────────────

/**
 * Walk backwards from the `seedType` nodes (and `seeds`) through edges to
 * find every node contributing to them. A zone output implicitly depends on
 * its input, but a simulation's that `computes` says is read rather than
 * computed (from the textures keeping its state).
 */
function findReachableNodeIds(
	nodes: Map<string, GraphNode>,
	edges: readonly { source: string; target: string }[],
	seedType: string,
	seeds: ReadonlySet<string> = new Set(),
	computes: (zoneInput: GraphNode) => boolean = () => true,
): Set<string> {
	const reverseAdj = new Map<string, string[]>();
	for (const node of nodes.values()) reverseAdj.set(node.id, []);
	for (const edge of edges) reverseAdj.get(edge.target)?.push(edge.source);
	for (const node of nodes.values()) {
		const output = pairedOutputId(node);
		if (output && computes(node)) reverseAdj.get(output)?.push(node.id);
	}

	const reachable = new Set<string>();
	const queue: string[] = [];
	for (const node of nodes.values()) {
		if (node.type === seedType || seeds.has(node.id)) {
			reachable.add(node.id);
			queue.push(node.id);
		}
	}

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) break;
		for (const source of reverseAdj.get(current) ?? []) {
			if (!reachable.has(source)) {
				reachable.add(source);
				queue.push(source);
			}
		}
	}

	return reachable;
}

/**
 * Topological sort of node IDs. Works on a DAG; throws if a cycle is detected.
 */
function topologicalSort(
	ids: Iterable<string>,
	edges: readonly { source: string; target: string }[],
): string[] {
	const adjacency = new Map<string, string[]>();
	const inDegree = new Map<string, number>();
	for (const id of ids) {
		adjacency.set(id, []);
		inDegree.set(id, 0);
	}
	for (const edge of edges) {
		if (!adjacency.has(edge.source) || !inDegree.has(edge.target)) continue;
		adjacency.get(edge.source)?.push(edge.target);
		inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
	}

	const queue: string[] = [];
	for (const [id, degree] of inDegree) if (degree === 0) queue.push(id);

	const sorted: string[] = [];
	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (nodeId === undefined) break;
		sorted.push(nodeId);
		for (const neighbor of adjacency.get(nodeId) ?? []) {
			const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
			inDegree.set(neighbor, newDegree);
			if (newDegree === 0) queue.push(neighbor);
		}
	}

	if (sorted.length !== inDegree.size) {
		throw new Error("Cycle detected in the node graph - cannot generate shader");
	}
	return sorted;
}

/**
 * The edges needed to compute the `seedType` nodes, and the state items of
 * each repeat zone (by Repeat Output id) they need. An item is needed when
 * its final value is read, or when its current value is read inside the loop
 * by something needed: others are left out, with what only they used. A
 * simulation's items are all computed by the passes computing its state.
 */
function neededEdges(
	nodes: Map<string, GraphNode>,
	edges: readonly GraphEdge[],
	seedType: string,
	seeds: ReadonlySet<string>,
	/** Zone items read without a link, by Repeat Output id: a viewer's. */
	read: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
	computes?: (zoneInput: GraphNode) => boolean,
): { edges: GraphEdge[]; reachable: Set<string>; liveItems: Map<string, Set<string>> } {
	const liveItems = new Map([...read].map(([id, items]) => [id, new Set(items)]));
	const itemOwner = (nodeId: string, handle: string): string | undefined => {
		const node = nodes.get(nodeId);
		if (node?.type === REPEAT_OUTPUT) return nodeId;
		if (
			node?.type === REPEAT_INPUT &&
			handle !== ITERATIONS_HANDLE &&
			handle !== ITERATION_HANDLE
		)
			return pairedOutputId(node);
		return undefined;
	};
	const isLive = (nodeId: string, handle: string): boolean => {
		const owner = itemOwner(nodeId, handle);
		return owner === undefined || (liveItems.get(owner)?.has(handle) ?? false);
	};
	for (;;) {
		const active = edges.filter((e) => isLive(e.target, e.targetHandle));
		const reachable = findReachableNodeIds(nodes, active, seedType, seeds, computes);
		let grew = false;
		for (const e of active) {
			if (!reachable.has(e.target) || isLive(e.source, e.sourceHandle)) continue;
			const owner = itemOwner(e.source, e.sourceHandle);
			if (owner === undefined) continue;
			liveItems.set(owner, new Set([...(liveItems.get(owner) ?? []), e.sourceHandle]));
			grew = true;
		}
		if (!grew) {
			const needed = active.filter((e) => reachable.has(e.source) && reachable.has(e.target));
			return { edges: needed, reachable, liveItems };
		}
	}
}

function getVarName(nodeId: string): string {
	return `v_${identSuffix(nodeId)}`;
}

function sanitizeIdent(id: string): string {
	return `h_${identSuffix(id)}`;
}

// ── Hashing ──────────────────────────────────────────────────────────────────

function stripLabels(data: NodeData): NodeData {
	return { ...data, label: undefined };
}

type HashedDocument = {
	nodes: GraphNode[];
	edges: GraphEdge[];
	inputs?: readonly GroupHandleDef[];
	outputs?: readonly GroupHandleDef[];
	defaults?: Record<string, InputValue>;
};

function hashDoc(doc: HashedDocument) {
	const handles = (list: readonly GroupHandleDef[] = []) =>
		list.map(({ id, type, variants }) => ({ id, type, variants }));
	return {
		inputs: handles(doc.inputs),
		outputs: handles(doc.outputs),
		defaults: doc.defaults,
		nodes: doc.nodes.map((n) => ({ id: n.id, type: n.type, data: stripLabels(n.data) })),
		edges: doc.edges.map((e) => ({
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle,
			targetHandle: e.targetHandle,
		})),
	};
}

/**
 * Hash only the subset of the project that actually contributes to the shader
 * output: nodes reachable from frag-output in the root document, the edges
 * between them, and any group definitions they reference (recursively).
 * Changes to disconnected nodes or unused group definitions won't change
 * this hash, avoiding unnecessary shader regeneration.
 */
export function reachableShaderHash(
	project: { definitions: Map<string, HashedDocument> },
	assets: readonly Asset[] = [],
): string {
	const root = project.definitions.get(ROOT_ID);
	if (!root) return "";

	const nodeMap = new Map<string, GraphNode>();
	for (const node of root.nodes) nodeMap.set(node.id, node);
	const reachableRootIds = findReachableNodeIds(nodeMap, root.edges, "frag-output");

	const visitedGroupDefs = new Set<string>();
	const defQueue: string[] = [];
	const visit = (node: GraphNode) => {
		if (node.type !== "node-group" || !node.group) return;
		if (visitedGroupDefs.has(node.group.definitionRef)) return;
		visitedGroupDefs.add(node.group.definitionRef);
		defQueue.push(node.group.definitionRef);
	};
	for (const nodeId of reachableRootIds) {
		const node = nodeMap.get(nodeId);
		if (node) visit(node);
	}
	while (defQueue.length > 0) {
		const ref = defQueue.pop();
		if (ref === undefined) break;
		for (const node of project.definitions.get(ref)?.nodes ?? []) visit(node);
	}

	const defs: Record<string, ReturnType<typeof hashDoc>> = {};
	for (const ref of visitedGroupDefs) {
		const def = project.definitions.get(ref);
		if (def) defs[ref] = hashDoc(def);
	}

	return JSON.stringify({
		// Their metadata (e.g. a video's duration) may be compiled in.
		assets,
		root: hashDoc({
			nodes: root.nodes.filter((n) => reachableRootIds.has(n.id)),
			edges: root.edges.filter(
				(e) => reachableRootIds.has(e.source) && reachableRootIds.has(e.target),
			),
		}),
		defs,
	});
}

// ── Code generation ──────────────────────────────────────────────────────────

export type CodegenGraph = Pick<
	GraphModel,
	"root" | "project" | "typeResolver" | "resolveDescriptor" | "resolveNode" | "assets"
>;

type LineMap = Map<string, { start: number; end: number }>;

/**
 * A group's generated function: its source, name and parameters' types by
 * handle id (its value inputs: a Texture input is no parameter).
 */
type GroupDecl = { decl: string; fnName: string; paramTypes: Record<string, WgslType> };

type ShaderState = {
	graph: CodegenGraph;
	helpers: HelperRegistry;
	/**
	 * Every group's generated function (and, for the first one, its output
	 * struct), keyed by definitionRef plus the absent fallback inputs, the
	 * known enum values, the types and the outputs read, so each variant is
	 * emitted once no matter how many instances use it.
	 */
	groupDecls: Map<string, GroupDecl>;
	/** Group output structs already declared, by name. */
	groupStructs: Set<string>;
	/** The definitions whose input values are uniforms (see `ShaderOptions`). */
	uniformScopes: ReadonlySet<string>;
	uniforms: Map<string, UniformValue>;
	sources: TextureSources;
	targetSize: TextureSize;
	/** The textures the shader reads, by `TextureSource.id`. */
	textures: Map<string, TextureBinding>;
	/** The samplers the shader uses, by filter and address. */
	samplers: Map<string, SamplerBinding>;
	/** How many variants of each group differ by the textures they read. */
	textureVariants: Map<string, number>;
	/** Whether each definition reads textures, itself or through groups it nests. */
	readsTextures: Map<string, boolean>;
	/** The simulation the shader computes something of (by `simulationId`), if any. */
	simulation?: string;
};

/** A generated fragment, the uniform values it reads and the textures it samples. */
export type ShaderSource = {
	fragment: string;
	uniforms: Record<string, UniformValue>;
	textures: readonly TextureBinding[];
	samplers: readonly SamplerBinding[];
};

export type ShaderOptions = {
	/**
	 * The definitions (`ROOT_ID` for the root) whose unlinked input values
	 * are read from uniforms rather than written into the shader: editing
	 * them then only changes the uniforms. Values of other documents stay literals.
	 */
	uniformScopes?: Iterable<string>;
	/**
	 * What the shader draws: an output as a colour (see `fieldColor`), or
	 * some of a simulation's state items; the fragment output by default.
	 */
	target?: ShaderTarget;
	/** The graph's texture sources, shared by the shaders of one graph state. */
	sources?: TextureSources;
	/** The size of what the shader draws into; the canvas' by default. */
	targetSize?: TextureSize;
};

/** A simulation's state at its start (its initial values), or this frame's (its step). */
export type SimulationStage = "start" | "step";

/** Some of a simulation's state items, at a stage, each drawn into the texture keeping it. */
export type SimulationTarget = {
	simulation: SimulationRef;
	stage: SimulationStage;
	items: readonly StateItem[];
};

export type ShaderTarget = SocketRef | SimulationTarget;

function isSimulationTarget(target: ShaderTarget): target is SimulationTarget {
	return "simulation" in target;
}

/**
 * What a shader computes in a group nested at `path` (group node ids, from
 * the document at hand), besides its seeds: each group on the way gives it
 * its caller as fields of its outputs it doesn't have, like a viewer output
 * it would have for the preview, so a shader can draw any socket, or compute
 * any simulation, of any group instance.
 */
type Probe = { path: readonly string[] } & (
	| { kind: "socket"; node: string; handle: string }
	| { kind: "simulation"; zone: string; stage: SimulationStage; items: readonly StateItem[] }
);

function probeOf(target: ShaderTarget): Probe {
	if (!isSimulationTarget(target)) return { kind: "socket", ...target };
	const { simulation, stage, items } = target;
	return { kind: "simulation", path: simulation.path, zone: simulation.zone, stage, items };
}

/** The probe of the group node it goes through at its level, as that group computes it. */
function innerProbe(probe: Probe): Probe {
	return { ...probe, path: probe.path.slice(1) };
}

function probeKey(probe: Probe): string {
	if (probe.kind === "socket") return `${[...probe.path, probe.node].join("/")}:${probe.handle}`;
	const items = probe.items.map((i) => i.texture).join(",");
	return `${[...probe.path, probe.zone].join("/")}:${probe.stage}:${items}`;
}

/** The types of the values a probe gives: a colour, or a texel per state item. */
function probeTypes(probe: Probe): WgslType[] {
	return probe.kind === "socket" ? ["vec4f"] : probe.items.map((i) => texelType(i.format));
}

/** The output struct field of a group giving its caller a probe's `index`th value. */
function probeField(index: number): string {
	return `viewer${String(index)}`;
}

/** The values of a state item: a texture item's are colours. */
function stateValueType(item: StateItem): WgslType {
	return isTexture(item.type) ? "vec4f" : item.type;
}

/**
 * How a document's shader computes a simulation zone in it: reading its
 * state (`opaque`), or computing its initial values (`start`), its next
 * state (`step`), or something in it from its previous state (`inline`).
 */
type SimulationMode = "opaque" | "start" | "step" | "inline";

/**
 * A value drawn as a colour: a vec3f opaque, as the fragment output takes
 * it, a scalar grey, a vec2f in red and green.
 */
function fieldColor(expr: string, type: WgslType): string {
	const components = typeComponents(type);
	const float = convertVar(expr, type, makeType("f32", components));
	switch (components) {
		case 1:
			return `vec4f(vec3f(${float}), 1.0)`;
		case 2:
			return `vec4f(${float}, 0.0, 1.0)`;
		case 3:
			return `vec4f(${float}, 1.0)`;
		case 4:
			return float;
	}
}

/**
 * Emits the body of one document (the root fragment or a group function).
 */
class BodyEmitter {
	readonly lines: string[] = [];
	readonly lineMap: LineMap = new Map();
	private nodeMap = new Map<string, GraphNode>();
	private incomingByTarget = new Map<string, GraphEdge[]>();
	/** WGSL variables standing for zone boundary outputs, keyed by node id then handle id. */
	private zoneVars = new Map<string, Map<string, string>>();
	/** The output handles of each node something reads. */
	private readHandles = new Map<string, Set<string>>();

	/** The inputs of the group the document is. */
	private inputs: readonly GroupHandleDef[];

	constructor(
		private state: ShaderState,
		doc: { nodes: GraphNode[]; inputs?: readonly GroupHandleDef[] },
		edges: GraphEdge[],
		readonly zones: ZoneAnalysis,
		/** Group-input handles the calling group node left unlinked (absent values). */
		private absentInputs: ReadonlySet<string> = new Set(),
		/** Enum values the calling group node set, by group-input handle. */
		private constants: ReadonlyMap<string, number> = new Map(),
		/** Whether unlinked input values are read from uniforms. */
		private uniforms = false,
		/** The types the document's variables take (see `TypeBindings`). */
		readonly bindings: TypeBindings = {},
		/** The state items each zone computes, by Repeat Output id (see `neededEdges`). */
		readonly liveItems: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
		/** The group nodes the document is computed through, from the root. */
		readonly path: readonly string[] = [],
		readonly probe?: Probe,
		/** How each simulation zone is computed, by zone id. */
		readonly simulations: ReadonlyMap<string, SimulationMode> = new Map(),
	) {
		for (const node of doc.nodes) this.nodeMap.set(node.id, node);
		this.inputs = doc.inputs ?? [];
		for (const edge of edges) {
			const list = this.incomingByTarget.get(edge.target) ?? [];
			list.push(edge);
			this.incomingByTarget.set(edge.target, list);
			const read = this.readHandles.get(edge.source) ?? new Set();
			read.add(edge.sourceHandle);
			this.readHandles.set(edge.source, read);
		}
		for (const zone of zones.zones.values()) {
			if (zone.kind === "simulation") {
				const vars = simulationVarNames(zone, this.zoneItems(zone));
				const inputVars = new Map(vars.previous);
				inputVars.set(DELTA_TIME_HANDLE, `${FRAME_VAR}.${SIMULATION_DELTA_FIELD}`);
				this.zoneVars.set(zone.inputId, inputVars);
				this.zoneVars.set(zone.outputId, vars.current);
				continue;
			}
			const vars = zoneVarNames(zone, this.zoneItems(zone));
			const inputVars = new Map(vars.state);
			inputVars.set(ITERATION_HANDLE, vars.index);
			this.zoneVars.set(zone.inputId, inputVars);
			this.zoneVars.set(zone.outputId, vars.state);
		}
	}

	/** The values a simulation target gives, once its zone is emitted (see `probeFields`). */
	simulationFields: string[] = [];

	node(id: string): GraphNode | undefined {
		return this.nodeMap.get(id);
	}

	private get enumDocument(): EnumDocument {
		return {
			nodesById: this.nodeMap,
			edgesByTarget: this.incomingByTarget,
			inputs: this.inputs,
			inputType: inputTypeIn(this.state, this.nodeMap, this.incomingByTarget, this.bindings),
		};
	}

	constantOf(node: GraphNode, inputId: string): number | undefined {
		return constantAt(this.enumDocument, node.id, inputId, this.constants);
	}

	zoneItems(zone: Zone): ZoneItem[] {
		return zoneItems(this.nodeMap.get(zone.outputId));
	}

	/** The type each of a zone's items has here, by item id. */
	zoneItemTypes(zone: Zone): ReadonlyMap<string, WgslType> {
		const input = this.nodeMap.get(zone.inputId);
		if (!input) return new Map();
		const { resolvedOutputs } = this.typeResolver.resolveNodeTypes(
			input,
			this.incoming(input.id),
			this.bindings,
		);
		return new Map(resolvedOutputs.map((o) => [o.id, valueType(o.type)]));
	}

	private get typeResolver() {
		return this.state.graph.typeResolver;
	}

	incoming(nodeId: string): GraphEdge[] {
		return this.incomingByTarget.get(nodeId) ?? [];
	}

	isPresent(node: GraphNode, inputId: string): boolean {
		let edge = this.incoming(node.id).find((e) => e.targetHandle === inputId);
		// A reroute's value is present where the one it passes on is.
		while (edge && this.nodeMap.get(edge.source)?.type === "reroute") {
			const source = edge.source;
			edge = this.incoming(source).find((e) => e.targetHandle === "in");
		}
		if (!edge) return false;
		const source = this.nodeMap.get(edge.source);
		return !(source?.type === "group-input" && this.absentInputs.has(edge.sourceHandle));
	}

	sourceExpr(edge: GraphEdge): string {
		if (isTexture(this.typeResolver.inferHandleType(edge, this.bindings))) {
			return this.sampleAtPixel(
				readSource(this.state.sources.output(this.path, edge.source, edge.sourceHandle)),
			);
		}
		const sourceNode = this.nodeMap.get(edge.source);
		if (sourceNode?.type === "group-input") {
			const constant = this.constants.get(edge.sourceHandle);
			return constant === undefined
				? sanitizeIdent(edge.sourceHandle)
				: formatWgslLiteral(this.sourceType(edge), constant);
		}
		const zoneVar = this.zoneVars.get(edge.source)?.get(edge.sourceHandle);
		if (zoneVar) return zoneVar;
		const base = getVarName(edge.source);
		if (sourceNode?.type === "node-group") return `${base}.${sanitizeIdent(edge.sourceHandle)}`;
		if (sourceNode && this.state.graph.resolveDescriptor(sourceNode).outputs.length > 1) {
			return `${base}_${identSuffix(edge.sourceHandle)}`;
		}
		return base;
	}

	/** The type of an edge's source; a texture's is its colour's, sampled at the pixel. */
	sourceType(edge: GraphEdge): WgslType {
		return valueType(this.typeResolver.inferHandleType(edge, this.bindings));
	}

	/** A texture linked to a value: its colour at the pixel, stretched over the target. */
	private sampleAtPixel(source: TextureSource): string {
		const texture = this.textureVar(source);
		const format = sourceFormat(source);
		const size = sourceSize(source);
		// Made for this pass' size, proved while compiling: its pixel is read exactly.
		if (size && sameSize(size, this.state.targetSize)) {
			return texelAsColor(
				`textureLoad(${texture}, vec2i(${FRAGMENT_VAR}.position), 0)`,
				format,
			);
		}
		return this.sampleAt(texture, format, `${FRAGMENT_VAR}.uv`);
	}

	/** A texture's colour at `uv`, read as its format allows. */
	private sampleAt(texture: string, format: TextureFormat, uv: string): string {
		return readTexture(texture, format, textureCoordinates(uv), {
			sampler: (filter, address) => this.samplerVar(filter, address),
			define: (name, source) => this.state.helpers.define(name, source),
		});
	}

	/** The outputs of a node something reads, the probe's included. */
	readOutputs(nodeId: string): ReadonlySet<string> {
		const read = this.readHandles.get(nodeId) ?? new Set<string>();
		const probe = this.probe;
		if (probe?.kind !== "socket" || probe.path.length !== 0 || probe.node !== nodeId) {
			return read;
		}
		return new Set([...read, probe.handle]);
	}

	/** The values of the probe (see `Probe`), from where they're computed. */
	probeFields(): string[] {
		const probe = this.probe;
		if (!probe) return [];
		const [inner] = probe.path;
		if (inner) return probeTypes(probe).map((_, k) => `${getVarName(inner)}.${probeField(k)}`);
		if (probe.kind === "simulation") return this.simulationFields;
		const edge = {
			id: "",
			source: probe.node,
			sourceHandle: probe.handle,
			target: "",
			targetHandle: "",
		};
		return [fieldColor(this.sourceExpr(edge), this.sourceType(edge))];
	}

	/** The module-scope texture reading `source`. */
	textureVar(source: TextureSource): string {
		const textures = this.state.textures;
		let binding = textures.get(source.id);
		if (!binding) {
			binding = { name: `runtime_texture_${String(textures.size)}`, source };
			textures.set(source.id, binding);
		}
		return binding.name;
	}

	/** The module-scope sampler filtering and addressing as asked. */
	samplerVar(filter: SamplerFilter, address: SamplerAddress): string {
		const key = `${filter}_${address}`;
		let binding = this.state.samplers.get(key);
		if (!binding) {
			binding = { name: `runtime_sampler_${key}`, filter, address };
			this.state.samplers.set(key, binding);
		}
		return binding.name;
	}

	convertedSource(edge: GraphEdge, target: WgslType): string {
		return convertVar(this.sourceExpr(edge), this.sourceType(edge), target);
	}

	/**
	 * The value fed to `node`'s input `inputId`, as an expression of type
	 * `target`: the connected source (converted) or the node's stored literal.
	 */
	inputExpr(node: GraphNode, inputId: string, target: WgslType, fallback?: InputValue): string {
		const edge = this.incoming(node.id).find((e) => e.targetHandle === inputId);
		if (edge) return this.convertedSource(edge, target);
		const value = node.data.values?.[inputId] ?? fallback;
		if (this.uniforms) {
			const input = this.state.graph
				.resolveDescriptor(node)
				.inputs.find((i) => i.id === inputId);
			if (!input || isUniformControl(inputControl(input, target))) {
				return this.uniformExpr(uniformName(node.id, inputId), target, value);
			}
		}
		return formatWgslLiteral(target, value);
	}

	/** A number (or numbers) of a node's own data, as an f32 / vecNf expression. */
	paramExpr(node: GraphNode, key: string, value: number | readonly number[]): string {
		const components = typeof value === "number" ? [value] : value;
		const type = makeType("f32", components.length);
		const [x = 0, y = 0, z = 0, w = 0] = components;
		const stored: InputValue = components.length === 1 ? x : { x, y, z, w };
		if (this.uniforms) {
			return this.uniformExpr(uniformName(node.id, key), type, stored);
		}
		return formatWgslLiteral(type, stored);
	}

	/** Declare a uniform holding `value`, and read it as `target`. */
	private uniformExpr(name: string, target: WgslType, value: InputValue | undefined): string {
		const uniform = uniformValue(target, value);
		const components = typeComponents(target);
		this.state.uniforms.set(name, uniform);
		const source = makeType("f32", components);
		return convertVar(`${UNIFORMS_VAR}.${name}`, source, target);
	}

	push(nodeId: string, statements: string[], indent: string) {
		const start = this.lines.length;
		for (const line of statements) this.lines.push(`${indent}${line}`);
		this.lineMap.set(nodeId, { start, end: this.lines.length });
	}

	emitNode(node: GraphNode, indent: string) {
		const incoming = this.incoming(node.id);
		const resolved = this.typeResolver.resolveNodeTypes(node, incoming, this.bindings);
		// A node only textures are read from computes nothing: they're read where they're used.
		const outputs = resolved.resolvedOutputs;
		const read = [...(this.readHandles.get(node.id) ?? [])];
		const texture = (id: string) => isTexture(outputs.find((o) => o.id === id)?.type);
		const probe = this.probe;
		const seed =
			probe && (probe.path[0] ?? (probe.kind === "socket" ? probe.node : "")) === node.id;
		if (outputs.length > 0 && read.every(texture) && !seed) return;
		if (node.type === "node-group") {
			this.emitGroupCall(node, indent);
			return;
		}

		const graph = this.state.graph;
		const descriptor = graph.resolveDescriptor(node);
		const varName = getVarName(node.id);
		const { resolvedInputs, resolvedOutputs } = resolved;
		const inputTypes = valueTypes(resolved.inputTypes);
		const outputType = valueType(resolved.outputType);
		const textureSourceOf = (id: string) =>
			readSource(
				resolvedInputs.some((i) => i.id === id)
					? this.state.sources.input(this.path, node.id, id)
					: this.state.sources.output(this.path, node.id, id),
			);
		const textureOf = (id: string) => this.textureVar(textureSourceOf(id));

		const outputVars: Record<string, string> = {};
		for (const outputDef of resolvedOutputs) {
			outputVars[outputDef.id] =
				descriptor.outputs.length > 1 ? `${varName}_${identSuffix(outputDef.id)}` : varName;
		}

		const typeOf = (id: string): WgslType => {
			const def = resolvedInputs.find((i) => i.id === id);
			return inputTypes[id] ?? valueType(def ? inputDefaultType(def) : "f32");
		};

		// Variadic inputs are pre-converted, non-variadic ones are raw; a
		// Texture input gives its texture.
		const ctxInputs: Record<string, string[]> = {};
		for (const inputDef of resolvedInputs) {
			const edgesForHandle = incoming.filter((e) => e.targetHandle === inputDef.id);
			if (isTexture(resolved.inputTypes[inputDef.id])) {
				ctxInputs[inputDef.id] = edgesForHandle.length > 0 ? [textureOf(inputDef.id)] : [];
			} else if (inputDef.variadic) {
				ctxInputs[inputDef.id] = edgesForHandle.map((e) =>
					this.convertedSource(e, typeOf(inputDef.id)),
				);
			} else {
				const first = edgesForHandle[0];
				ctxInputs[inputDef.id] = first ? [this.sourceExpr(first)] : [];
			}
		}

		const promoteInput = (id: string): string => {
			const inputDef = resolvedInputs.find((i) => i.id === id);
			if (isTexture(resolved.inputTypes[id])) return textureOf(id);
			if (inputDef?.variadic) return (ctxInputs[id] ?? []).join(", ");
			return this.inputExpr(node, id, typeOf(id), descriptor.defaultData.values?.[id]);
		};

		const statements = descriptor.wgsl({
			varName,
			outputVars,
			data: node.data,
			inputs: ctxInputs,
			inputTypes,
			outputType,
			resolvedOutputs,
			resolvedInputs,
			promoteInput,
			isPresent: (id) => this.isPresent(node, id),
			convert: convertVar,
			helper: (name, type) => this.state.helpers.use(name, type),
			constant: (id) => this.constantOf(node, id),
			param: (key, value) => this.paramExpr(node, key, value),
			fn: (name, source) => this.state.helpers.define(name, source),
			texture: textureOf,
			textureFormat: (id) => sourceFormat(textureSourceOf(id)),
			sampler: (filter, address) => this.samplerVar(filter, address),
			asset: () => graph.assets.find((a) => a.id === node.data.asset),
		});
		this.push(node.id, statements, indent);
	}

	private emitGroupCall(node: GraphNode, indent: string) {
		const definitionRef = node.group?.definitionRef;
		if (!definitionRef) return;
		const descriptor = this.state.graph.resolveDescriptor(node);
		// Fallback inputs this call leaves without a value pick the group's own default.
		const absent = new Set(
			descriptor.inputs
				.filter((i) => i.fallback && !this.isPresent(node, i.id))
				.map((i) => i.id),
		);
		const defaults = descriptor.defaultData.values;
		const resolved = this.typeResolver.resolveNodeTypes(
			node,
			this.incoming(node.id),
			this.bindings,
		);
		// Enum values known here are compiled into the call's function.
		const constants = groupConstants(
			this.enumDocument,
			node,
			this.state.graph.project.definitions,
			resolved.bindings ?? {},
			this.constants,
		);
		const decl = emitGroupFunction(
			this.state,
			definitionRef,
			absent,
			constants,
			resolved.bindings,
			this.readOutputs(node.id),
			[...this.path, node.id],
			this.probe?.path[0] === node.id ? innerProbe(this.probe) : undefined,
		);
		if (!decl) return;
		// Converted to the function's parameters, which its body was emitted for.
		const args = descriptor.inputs.flatMap((inputDef) => {
			const type = decl.paramTypes[inputDef.id];
			return type === undefined
				? []
				: [this.inputExpr(node, inputDef.id, type, defaults?.[inputDef.id])];
		});
		this.push(
			node.id,
			[`let ${getVarName(node.id)} = ${decl.fnName}(${args.join(", ")});`],
			indent,
		);
	}
}

/** A simulation's previous state, read in it, and its current one, read after it. */
function simulationVarNames(zone: Zone, items: ZoneItem[]) {
	const ident = identSuffix(zone.id);
	return {
		previous: new Map(items.map((item, k) => [item.id, `z_${ident}_p${String(k)}`])),
		current: new Map(items.map((item, k) => [item.id, `z_${ident}_c${String(k)}`])),
		next: items.map((_, k) => `z_${ident}_next${String(k)}`),
		skip: `z_${ident}_skip`,
	};
}

function zoneVarNames(zone: Zone, items: ZoneItem[]) {
	const ident = identSuffix(zone.id);
	return {
		index: `z_${ident}_i`,
		count: `z_${ident}_n`,
		state: new Map(items.map((item, k) => [item.id, `z_${ident}_s${String(k)}`])),
		next: items.map((_, k) => `z_${ident}_next${String(k)}`),
	};
}

/** The type an input of a node of a document resolves to, its variables taking `bindings`. */
function inputTypeIn(
	state: ShaderState,
	nodeMap: ReadonlyMap<string, GraphNode>,
	edgesByTarget: ReadonlyMap<string, GraphEdge[]>,
	bindings: TypeBindings,
): NonNullable<EnumDocument["inputType"]> {
	return (nodeId, inputId) => {
		const node = nodeMap.get(nodeId);
		if (!node) return undefined;
		const type = state.graph.typeResolver.resolveNodeTypes(
			node,
			edgesByTarget.get(nodeId) ?? [],
			bindings,
		).inputTypes[inputId];
		return type === undefined || isTexture(type) ? undefined : type;
	};
}

/**
 * Emit the nodes of a document needed to compute `seedType` nodes.
 *
 * Nodes are grouped by scope: the document's top level, then each zone.
 * Within a scope, nodes and child zones are emitted in dependency order; a
 * child repeat zone becomes a `for` loop whose body is its own scope. Loop
 * invariants live in the enclosing scope, so they are computed once before
 * the loop. A simulation zone is computed by passes of its own, its state
 * read from the textures keeping it, but where the probe is in it (see
 * `SimulationMode`). Invalid links, and links to sockets the nodes don't
 * have with `bindings`, are ignored (inputs fall back to their stored values).
 */
function emitDocumentBody(
	state: ShaderState,
	doc: { nodes: GraphNode[]; edges: GraphEdge[]; inputs?: readonly GroupHandleDef[] },
	seedType: string,
	absentInputs: ReadonlySet<string> = new Set(),
	constants: ReadonlyMap<string, number> = new Map(),
	uniforms = false,
	bindings: TypeBindings = {},
	/** The seed's input handles to compute; all of them when undefined. */
	seedHandles?: ReadonlySet<string>,
	/** The group nodes the document is computed through, from the root. */
	path: readonly string[] = [],
	/** What to compute besides the seeds, and give its caller (see `Probe`). */
	probe?: Probe,
): BodyEmitter {
	const nodeMap = new Map<string, GraphNode>();
	for (const node of doc.nodes) nodeMap.set(node.id, node);

	const zones = analyzeZones(doc.nodes, doc.edges, {
		simulating: simulatingDefinitions(state.graph.project.definitions),
	});

	// The node the probe is computed at, here: the group node it goes through,
	// or the socket's node, or the boundary node whose inputs a simulation
	// target computes.
	const probeZone = probe?.kind === "simulation" ? zones.zones.get(probe.zone) : undefined;
	const probeNode =
		probe &&
		(probe.path[0] ??
			(probe.kind === "socket"
				? probe.node
				: probe.stage === "start"
					? probe.zone
					: probeZone?.outputId));
	const simulations = new Map<string, SimulationMode>();
	for (const zone of zones.zones.values()) {
		if (zone.kind !== "simulation") continue;
		let mode: SimulationMode = "opaque";
		if (probe?.kind === "simulation" && probe.path.length === 0 && probe.zone === zone.id) {
			mode = probe.stage;
		} else if (
			probeNode !== undefined &&
			(zone.members.has(probeNode) || probeNode === zone.inputId)
		) {
			mode = "inline";
		}
		simulations.set(zone.id, mode);
		if (mode !== "opaque") state.simulation = simulationId({ path, zone: zone.id });
	}
	const probeItems = new Set(
		probe?.kind === "simulation" && probe.path.length === 0
			? probe.items.map((i) => i.item.id)
			: [],
	);
	/** Whether a link into a simulation's boundary node is computed here. */
	const intoSimulation = (e: GraphEdge): boolean => {
		const zone = zones.zones.get(zones.zoneOfBoundary.get(e.target) ?? "");
		const mode = zone && simulations.get(zone.id);
		if (!zone || !mode) return true;
		if (e.target === zone.inputId) return mode === "start";
		return (
			mode === "step" && (e.targetHandle === SKIP_HANDLE || probeItems.has(e.targetHandle))
		);
	};

	const incoming = new Map<string, GraphEdge[]>();
	for (const e of doc.edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
	const unavailable = unavailableEdges(doc.edges, (id) => {
		const node = nodeMap.get(id);
		return (
			node &&
			state.graph.typeResolver.resolveNodeTypes(node, incoming.get(id) ?? [], bindings)
		);
	});
	// Links into Texture inputs compute nothing here: textures are read where
	// they're used, and values are rendered to them by passes of their own.
	const intoTexture = (e: GraphEdge) => {
		const node = nodeMap.get(e.target);
		return (
			!!node &&
			isTexture(
				state.graph.typeResolver.resolveNodeTypes(
					node,
					incoming.get(e.target) ?? [],
					bindings,
				).inputTypes[e.targetHandle],
			)
		);
	};
	const validEdges = doc.edges.filter(
		(e) =>
			!zones.invalidEdges.has(e.id) &&
			!unavailable.has(e.id) &&
			!intoTexture(e) &&
			intoSimulation(e),
	);
	const edgesByTarget = new Map<string, GraphEdge[]>();
	for (const e of validEdges)
		edgesByTarget.set(e.target, [...(edgesByTarget.get(e.target) ?? []), e]);
	const usedEdges = liveEdges(
		{
			nodesById: nodeMap,
			edgesByTarget,
			inputs: doc.inputs ?? [],
			inputType: inputTypeIn(state, nodeMap, edgesByTarget, bindings),
		},
		validEdges,
		constants,
	).filter(
		(e) =>
			!seedHandles ||
			nodeMap.get(e.target)?.type !== seedType ||
			seedHandles.has(e.targetHandle),
	);
	const seeds = new Set(probeNode === undefined ? [] : [probeNode]);
	const viewed =
		probe?.kind === "socket" &&
		probe.path.length === 0 &&
		nodeMap.get(probe.node)?.type === REPEAT_OUTPUT
			? new Map([[probe.node, new Set([probe.handle])]])
			: undefined;
	const computed = (input: GraphNode) => {
		const mode = simulations.get(input.id);
		return mode !== "opaque" && mode !== "start";
	};
	const { edges, reachable, liveItems } = neededEdges(
		nodeMap,
		usedEdges,
		seedType,
		seeds,
		viewed,
		computed,
	);
	const emitter = new BodyEmitter(
		state,
		doc,
		edges,
		zones,
		absentInputs,
		constants,
		uniforms,
		bindings,
		liveItems,
		path,
		probe,
		simulations,
	);

	/** The unit (node id, or child zone id) standing for `nodeId` within `scope`. */
	const unitIn = (scope: string | null, nodeId: string): string | undefined => {
		let zone = zones.nodeZone.get(nodeId) ?? null;
		if (zone === scope) return zones.zoneOfBoundary.has(nodeId) ? undefined : nodeId;
		while (zone !== null) {
			const parent = zones.zones.get(zone)?.parent ?? null;
			if (parent === scope) return `zone:${zone}`;
			zone = parent;
		}
		return undefined;
	};

	const emitScope = (scope: string | null, indent: string) => {
		const units = new Set<string>();
		for (const id of reachable) {
			const unit = unitIn(scope, id);
			if (unit) units.add(unit);
		}
		const unitEdges: { source: string; target: string }[] = [];
		for (const e of edges) {
			const source = unitIn(scope, e.source);
			const target = unitIn(scope, e.target);
			if (source && target && source !== target) unitEdges.push({ source, target });
		}
		for (const unit of topologicalSort(units, unitEdges)) {
			if (unit.startsWith("zone:")) {
				const zone = zones.zones.get(unit.slice("zone:".length));
				if (zone?.kind === "simulation") emitSimulation(zone, indent);
				else if (zone) emitZoneLoop(zone, indent);
				continue;
			}
			const node = nodeMap.get(unit);
			if (!node?.type || node.type === "group-input" || node.type === "group-output")
				continue;
			emitter.emitNode(node, indent);
		}
	};

	const emitZoneLoop = (zone: Zone, indent: string) => {
		const input = nodeMap.get(zone.inputId);
		const output = nodeMap.get(zone.outputId);
		if (!input || !output) return;
		const allItems = emitter.zoneItems(zone);
		const vars = zoneVarNames(zone, allItems);
		const live = liveItems.get(zone.outputId);
		// Variables keep their item's index among all items, live or not.
		const items = allItems.flatMap((item, k) =>
			live?.has(item.id)
				? [{ item, state: vars.state.get(item.id) ?? "", next: vars.next[k] ?? "" }]
				: [],
		);

		const types = emitter.zoneItemTypes(zone);
		const typeOf = (item: ZoneItem) => types.get(item.id) ?? "f32";

		const setup: string[] = items.map(
			({ item, state }) =>
				`var ${state}: ${wgslTypeName(typeOf(item))} = ${emitter.inputExpr(input, item.id, typeOf(item))};`,
		);
		const iterations = emitter.inputExpr(input, ITERATIONS_HANDLE, "i32", DEFAULT_ITERATIONS);
		const max = String(zoneMaxIterations(input));
		setup.push(
			`let ${vars.count} = clamp(${iterations}, 0, ${max});`,
			`for (var ${vars.index}: i32 = 0; ${vars.index} < ${vars.count}; ${vars.index}++) {`,
		);
		emitter.push(zone.inputId, setup, indent);

		emitScope(zone.id, `${indent}  `);

		// Compute every next value before assigning any: a next value may read
		// another item's current value.
		const update = [
			...items.map(
				({ item, next }) =>
					`  let ${next} = ${emitter.inputExpr(output, item.id, typeOf(item))};`,
			),
			...items.map(({ state, next }) => `  ${state} = ${next};`),
			"}",
		];
		emitter.push(zone.outputId, update, indent);
	};

	const emitSimulation = (zone: Zone, indent: string) => {
		const input = nodeMap.get(zone.inputId);
		const output = nodeMap.get(zone.outputId);
		const simulation = state.sources.simulation(path, zone.id);
		if (!input || !output || !simulation) return;
		const mode = simulations.get(zone.id) ?? "opaque";
		const vars = simulationVarNames(zone, emitter.zoneItems(zone));
		const index = new Map(emitter.zoneItems(zone).map((item, k) => [item.id, k]));
		const load = (item: StateItem, read: "previous" | "current") =>
			`textureLoad(${emitter.textureVar(stateSource(simulation.ref, item, read))}, vec2i(${FRAGMENT_VAR}.position), 0)`;
		// A texture item's values are read where they're used, as a texture.
		const values = simulation.items.filter((i) => !isTexture(i.type));
		const targeted = probe?.kind === "simulation" ? probe.items : [];

		if (mode === "opaque") {
			const read = emitter.readOutputs(zone.outputId);
			const lines = values
				.filter((i) => read.has(i.item.id))
				.map(
					(i) =>
						`let ${vars.current.get(i.item.id) ?? ""} = ${unpackState(load(i, "current"), stateValueType(i), i.format)};`,
				);
			emitter.push(zone.outputId, lines, indent);
			return;
		}
		if (mode === "start") {
			emitter.simulationFields = targeted.map((i) => {
				const type = stateValueType(i);
				return packState(emitter.inputExpr(input, i.item.id, type), type, i.format);
			});
			return;
		}

		const read = emitter.readOutputs(zone.inputId);
		const step = mode === "step";
		const previous = values
			.filter((i) => read.has(i.item.id) || (step && targeted.includes(i)))
			.map(
				(i) =>
					`let ${vars.previous.get(i.item.id) ?? ""} = ${unpackState(load(i, "previous"), stateValueType(i), i.format)};`,
			);
		emitter.push(zone.inputId, previous, indent);

		emitScope(zone.id, indent);

		if (!step) return;
		// Skipping keeps the previous frame's state: the nodes in the zone don't change it.
		const update = [
			`let ${vars.skip} = ${emitter.inputExpr(output, SKIP_HANDLE, "bool", false)};`,
		];
		emitter.simulationFields = targeted.map((i) => {
			const type = stateValueType(i);
			const next = vars.next[index.get(i.item.id) ?? 0] ?? "";
			const kept = isTexture(i.type) ? load(i, "previous") : vars.previous.get(i.item.id);
			update.push(
				`let ${next} = select(${emitter.inputExpr(output, i.item.id, type)}, ${kept ?? ""}, ${vars.skip});`,
			);
			return packState(next, type, i.format);
		});
		emitter.push(zone.outputId, update, indent);
	};

	emitScope(null, "  ");
	return emitter;
}

/** Node types reading or giving textures of their own: a simulation's keep its state. */
const TEXTURE_NODE_TYPES: ReadonlySet<string> = new Set([
	...MEDIA_NODE_TYPES,
	SAMPLE_TEXTURE,
	TEXTURE_SIZE,
	SIMULATION_INPUT,
	SIMULATION_OUTPUT,
]);

/** Whether a definition reads textures: itself, through its sockets or the groups it nests. */
function readsTextures(state: ShaderState, definitionRef: string): boolean {
	const known = state.readsTextures.get(definitionRef);
	if (known !== undefined) return known;
	// A group nesting itself reads none through itself.
	state.readsTextures.set(definitionRef, false);
	const def = state.graph.project.definitions.get(definitionRef);
	const texture = (h: GroupHandleDef) => h.type === "texture";
	const reads =
		!!def &&
		(def.inputs.some(texture) ||
			def.outputs.some(texture) ||
			def.nodes.some(
				(n) =>
					TEXTURE_NODE_TYPES.has(n.type) ||
					(n.type === "node-group" &&
						!!n.group &&
						readsTextures(state, n.group.definitionRef)),
			));
	state.readsTextures.set(definitionRef, reads);
	return reads;
}

/**
 * What the textures read by a group instance at `path` are (its own nodes'
 * and those of the groups it nests): its variants reading other textures
 * are other functions. Empty for a group reading none.
 */
function textureFingerprint(state: ShaderState, definitionRef: string, path: readonly string[]) {
	if (!readsTextures(state, definitionRef)) return "";
	const def = state.graph.project.definitions.get(definitionRef);
	const instance = state.sources.instance(path);
	if (!def || !instance) return "";
	const parts: string[] = [];
	for (const node of def.nodes) {
		// Each instance keeps a state of its own.
		if (node.type === SIMULATION_INPUT) {
			parts.push(`sim:${simulationId({ path, zone: node.id })}`);
		}
		if (node.type === "node-group" && node.group) {
			const nested = textureFingerprint(state, node.group.definitionRef, [...path, node.id]);
			if (nested !== "") parts.push(`${node.id}(${nested})`);
		}
		const types = state.graph.typeResolver.resolveNodeTypes(
			node,
			def.edgesByTarget.get(node.id) ?? [],
			instance.bindings,
		);
		for (const [id, type] of Object.entries(types.inputTypes)) {
			if (isTexture(type))
				parts.push(`${node.id}.${id}=${state.sources.input(path, node.id, id).id}`);
		}
		for (const output of types.resolvedOutputs) {
			if (isTexture(output.type)) {
				parts.push(
					`${node.id}:${output.id}=${state.sources.output(path, node.id, output.id).id}`,
				);
			}
		}
	}
	return parts.join(",");
}

/** Generate one group's `struct` + `fn` (recursively for nested groups). */
function emitGroupFunction(
	state: ShaderState,
	definitionRef: string,
	absentInputs: ReadonlySet<string> = new Set(),
	constants: ReadonlyMap<string, number> = new Map(),
	given: TypeBindings = {},
	/** The outputs the caller reads; all of them when undefined. */
	readOutputs?: ReadonlySet<string>,
	/** The group nodes it's computed through, from the root, the caller last. */
	path: readonly string[] = [],
	probe?: Probe,
): GroupDecl | undefined {
	const definition: HydratedGraphDocument | undefined =
		state.graph.project.definitions.get(definitionRef);
	if (!definition) return undefined;
	const variables = definition.typeVariables;
	const bindings = completeBindings(variables, given);

	const inputHandles = definition.inputs;
	const outputHandles = definition.outputs;
	// Each output is computed by the Group Output node it's linked on, if any.
	const groupOutputs = definition.nodes.filter((n) => n.type === "group-output");
	const outputNodeOf = (h: GroupHandleDef) =>
		groupOutputs.find((n) =>
			definition.edgesByTarget.get(n.id)?.some((e) => e.targetHandle === h.id),
		) ?? groupOutputs[0];

	// One function per combination of absent fallback inputs, enum values,
	// variables' types and outputs read, so each only contains what it uses.
	const absentIndices = inputHandles.flatMap((h, i) => (absentInputs.has(h.id) ? [i] : []));
	const enumValues = inputHandles.flatMap((h, i) => {
		const value = constants.get(h.id);
		return value === undefined ? [] : [`${String(i)}_${String(value)}`];
	});
	const typeSuffix = variables.map((v) => bindings[v.id] ?? "f32").join("_");
	const unreadIndices = outputHandles.flatMap((h, i) =>
		readOutputs && !readOutputs.has(h.id) ? [i] : [],
	);
	const textures = textureFingerprint(state, definitionRef, path);
	const key = [
		definitionRef,
		...absentIndices,
		"e",
		...enumValues,
		"t",
		typeSuffix,
		"u",
		...unreadIndices,
		"x",
		textures,
		"v",
		probe ? probeKey(probe) : "",
	].join("|");
	const existing = state.groupDecls.get(key);
	if (existing) return existing;

	const ident = sanitizeIdent(definitionRef);
	// Variants reading other textures are numbered, their reads being too long for a name.
	const textureVariant =
		textures === "" ? undefined : (state.textureVariants.get(definitionRef) ?? 0);
	if (textureVariant !== undefined) state.textureVariants.set(definitionRef, textureVariant + 1);
	const suffix = [
		...(absentIndices.length > 0 ? [`d${absentIndices.join("_")}`] : []),
		...enumValues.map((v) => `e${v}`),
		...(unreadIndices.length > 0 ? [`u${unreadIndices.join("_")}`] : []),
		...(textureVariant === undefined ? [] : [`x${String(textureVariant)}`]),
		...(probe ? ["v"] : []),
	];
	const fnName = [`group_${ident}`, ...suffix, ...(typeSuffix ? [`t_${typeSuffix}`] : [])].join(
		"__",
	);
	const structName = [
		`GroupOutputs_${ident}`,
		...(typeSuffix ? [typeSuffix] : []),
		...(probe ? ["v"] : []),
	].join("__");

	const readHandles = new Set(
		outputHandles.filter((_, i) => !unreadIndices.includes(i)).map((h) => h.id),
	);
	const body = emitDocumentBody(
		state,
		definition,
		"group-output",
		absentInputs,
		constants,
		state.uniformScopes.has(definitionRef),
		bindings,
		readHandles,
		path,
		probe,
	);

	// Struct fields follow the handle types; whatever feeds them is converted
	// on the way in, exactly like any other typed input.
	const outputTypes = (node: GraphNode | undefined) =>
		node
			? state.graph.typeResolver.resolveNodeTypes(
					node,
					definition.edgesByTarget.get(node.id) ?? [],
					bindings,
				).inputTypes
			: {};
	// Textures are no WGSL values: they're read where they're used, never passed.
	const valueHandles = (
		handles: readonly GroupHandleDef[],
		type: (h: GroupHandleDef) => SocketType,
	) =>
		handles.flatMap((h) => {
			const t = type(h);
			return isTexture(t) ? [] : [{ handle: h, type: t }];
		});
	const outputs = valueHandles(
		outputHandles,
		(h) =>
			boundType(h.type, variables, bindings) ?? outputTypes(outputNodeOf(h))[h.id] ?? "f32",
	);
	const inputs = valueHandles(
		inputHandles,
		(h) => boundType(h.type, variables, bindings) ?? "f32",
	);
	// Outputs the caller doesn't read keep their struct field, zeroed.
	const fieldValues = outputs.map(({ handle, type }) => {
		const node = outputNodeOf(handle);
		return node && readHandles.has(handle.id)
			? body.inputExpr(node, handle.id, type)
			: WGSL_DEFAULTS[type];
	});
	fieldValues.push(...body.probeFields());
	const structFields = [
		...outputs.map(
			({ handle, type }) => `  ${sanitizeIdent(handle.id)}: ${wgslTypeName(type)},`,
		),
		...(probe
			? probeTypes(probe).map((t, k) => `  ${probeField(k)}: ${wgslTypeName(t)},`)
			: []),
	].join("\n");
	const params = inputs
		.map(({ handle, type }) => `${sanitizeIdent(handle.id)}: ${wgslTypeName(type)}`)
		.join(", ");

	// The specialisations of a definition with the same types share one output struct.
	const firstOfDefinition = !state.groupStructs.has(structName);
	state.groupStructs.add(structName);
	const decl = [
		...(firstOfDefinition ? [`struct ${structName} {\n${structFields}\n}`, ""] : []),
		`fn ${fnName}(${params}) -> ${structName} {`,
		...body.lines,
		`  return ${structName}(${fieldValues.join(", ")});`,
		`}`,
	].join("\n");

	const paramTypes = Object.fromEntries(inputs.map(({ handle, type }) => [handle.id, type]));
	const entry = { decl, fnName, paramTypes };
	state.groupDecls.set(key, entry);
	return entry;
}

/**
 * Emit the full WGSL fragment shader source from the graph: `frag` returns
 * a colour, or, for a simulation target, a `TARGETS_STRUCT` of the texels of
 * its items (`targets` their types).
 */
export function generateShader(
	graph: CodegenGraph,
	{
		uniformScopes = [],
		target,
		sources = new TextureSources(graph),
		targetSize = CANVAS_SIZE,
	}: ShaderOptions = {},
): {
	shader: string;
	lineMap: LineMap;
	uniforms: Record<string, UniformValue>;
	textures: TextureBinding[];
	samplers: SamplerBinding[];
	targets?: readonly WgslType[];
	simulation?: string;
} {
	const state: ShaderState = {
		graph,
		helpers: new HelperRegistry(),
		groupDecls: new Map(),
		groupStructs: new Set(),
		uniformScopes: new Set(uniformScopes),
		uniforms: new Map(),
		sources,
		targetSize,
		textures: new Map(),
		samplers: new Map(),
		textureVariants: new Map(),
		readsTextures: new Map(),
	};

	const probe = target && probeOf(target);
	const body = emitDocumentBody(
		state,
		graph.root,
		target ? "" : "frag-output",
		new Set(),
		new Map(),
		state.uniformScopes.has(ROOT_ID),
		{},
		undefined,
		[],
		probe,
	);
	const output = graph.root.nodes.find((n) => n.type === "frag-output");
	const targets = probe?.kind === "simulation" ? probeTypes(probe) : undefined;
	const fields = probe && body.probeFields();
	const result = targets
		? `${TARGETS_STRUCT}(${(fields ?? []).join(", ")})`
		: fields
			? fields[0]
			: output && body.lineMap.has(output.id)
				? getVarName(output.id)
				: undefined;

	const preamble: string[] = [];
	// Every group's struct + fn, emitted once each, before frag() itself.
	for (const { decl } of state.groupDecls.values()) preamble.push(decl, "");
	const helpers = state.helpers.emit();
	if (helpers.length > 0) {
		preamble.push("// ---------- Common libraries ----------", "");
		for (const fn of helpers) preamble.push(fn, "");
	}
	preamble.push(
		"// ---------- User code ----------",
		"",
		`fn frag(uv: vec2f) -> ${targets ? TARGETS_STRUCT : "vec4f"} {`,
	);

	// Offset the line map so line numbers correspond to the final shader string.
	const offset = preamble.length;
	const lineMap: LineMap = new Map();
	for (const [nodeId, range] of body.lineMap) {
		lineMap.set(nodeId, { start: range.start + offset, end: range.end + offset });
	}

	const shader = [
		...preamble,
		...body.lines,
		result ? `  return ${result};` : `  return ${WGSL_DEFAULTS.vec4f};`,
		"}",
	].join("\n");

	return {
		shader,
		lineMap,
		uniforms: Object.fromEntries(state.uniforms),
		textures: [...state.textures.values()],
		samplers: [...state.samplers.values()],
		...(targets ? { targets } : {}),
		...(state.simulation === undefined ? {} : { simulation: state.simulation }),
	};
}
