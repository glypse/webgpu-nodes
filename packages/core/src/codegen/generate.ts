import { type EnumDocument, constantAt, groupConstants, liveEdges } from "../enums";
import { ROOT_ID, type GraphEdge } from "../graph/document";
import type { HydratedGraphDocument } from "../graph/document";
import type { GraphNode } from "../graph/document";
import type { GraphModel } from "../graph/model";
import { componentKeys, readComponent } from "../graph/values";
import type {
	GroupHandleDef,
	HandleDef,
	InputValue,
	NodeData,
	TypeBindings,
	WgslType,
} from "../types";
import {
	WGSL_DEFAULTS,
	boundType,
	completeBindings,
	convertVar,
	inputControl,
	inputDefaultType,
	isUniformControl,
	makeType,
	typeKind,
	wgslTypeName,
} from "../types";
import {
	DEFAULT_ITERATIONS,
	ITERATIONS_HANDLE,
	ITERATION_HANDLE,
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	type Zone,
	type ZoneAnalysis,
	analyzeZones,
	pairedOutputId,
	zoneItems,
	zoneMaxIterations,
} from "../zones";
import { HelperRegistry } from "./helpers";
import { formatWgslLiteral, scalarNumber } from "./literals";
import { UNIFORMS_VAR } from "./program";

// ── Graph walking ────────────────────────────────────────────────────────────

/**
 * Walk backwards from the `seedType` nodes through edges to find every node
 * contributing to them. A Repeat Output implicitly depends on its Repeat Input.
 */
function findReachableNodeIds(
	nodes: Map<string, GraphNode>,
	edges: readonly { source: string; target: string }[],
	seedType: string,
): Set<string> {
	const reverseAdj = new Map<string, string[]>();
	for (const node of nodes.values()) reverseAdj.set(node.id, []);
	for (const edge of edges) reverseAdj.get(edge.target)?.push(edge.source);
	for (const node of nodes.values()) {
		const output = node.type === REPEAT_INPUT ? pairedOutputId(node) : undefined;
		if (output) reverseAdj.get(output)?.push(node.id);
	}

	const reachable = new Set<string>();
	const queue: string[] = [];
	for (const node of nodes.values()) {
		if (node.type === seedType) {
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
 * by something needed: others are left out, with what only they used.
 */
function neededEdges(
	nodes: Map<string, GraphNode>,
	edges: readonly GraphEdge[],
	seedType: string,
): { edges: GraphEdge[]; reachable: Set<string>; liveItems: Map<string, Set<string>> } {
	const liveItems = new Map<string, Set<string>>();
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
		const reachable = findReachableNodeIds(nodes, active, seedType);
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

/** WGSL identifiers can't contain characters like "-" from a UUID's dashes. */
function identSuffix(id: string): string {
	return id.replace(/[^A-Za-z0-9_]/g, "_");
}

function getVarName(nodeId: string): string {
	return `v_${identSuffix(nodeId)}`;
}

function sanitizeIdent(id: string): string {
	return `h_${identSuffix(id)}`;
}

// ── Hashing ──────────────────────────────────────────────────────────────────

function stripLabels(data: NodeData): NodeData {
	return {
		...data,
		label: undefined,
		...(data.handles
			? { handles: data.handles.map(({ id, type }) => ({ id, type, label: "" })) }
			: {}),
	};
}

function hashDoc(doc: { nodes: GraphNode[]; edges: GraphEdge[] }) {
	return {
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
export function reachableShaderHash(project: {
	definitions: Map<string, { nodes: GraphNode[]; edges: GraphEdge[] }>;
}): string {
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
	"root" | "project" | "typeResolver" | "resolveDescriptor" | "resolveNode"
>;

type LineMap = Map<string, { start: number; end: number }>;

/** A group's generated function: its source, name and parameters' types by handle id. */
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
};

/**
 * A uniform's value: a number for an f32, its components for a vecNf.
 * Uniforms are always floats, converted to the input's type in the shader.
 */
export type UniformValue =
	| number
	| [number, number]
	| [number, number, number]
	| [number, number, number, number];

/** A generated fragment and the uniform values it reads. */
export type ShaderSource = { fragment: string; uniforms: Record<string, UniformValue> };

export type ShaderOptions = {
	/**
	 * The definitions (`ROOT_ID` for the root) whose unlinked input values
	 * are read from uniforms rather than written into the shader: editing
	 * them then only changes the uniforms. Values of other documents stay literals.
	 */
	uniformScopes?: Iterable<string>;
};

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

	constructor(
		private state: ShaderState,
		doc: { nodes: GraphNode[] },
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
	) {
		for (const node of doc.nodes) this.nodeMap.set(node.id, node);
		for (const edge of edges) {
			const list = this.incomingByTarget.get(edge.target) ?? [];
			list.push(edge);
			this.incomingByTarget.set(edge.target, list);
			const read = this.readHandles.get(edge.source) ?? new Set();
			read.add(edge.sourceHandle);
			this.readHandles.set(edge.source, read);
		}
		for (const zone of zones.zones.values()) {
			const vars = zoneVarNames(zone, this.zoneItems(zone));
			const inputVars = new Map(vars.state);
			inputVars.set(ITERATION_HANDLE, vars.index);
			this.zoneVars.set(zone.inputId, inputVars);
			this.zoneVars.set(zone.outputId, vars.state);
		}
	}

	node(id: string): GraphNode | undefined {
		return this.nodeMap.get(id);
	}

	private get enumDocument(): EnumDocument {
		return { nodesById: this.nodeMap, edgesByTarget: this.incomingByTarget };
	}

	constantOf(node: GraphNode, inputId: string): number | undefined {
		return constantAt(this.enumDocument, node.id, inputId, this.constants);
	}

	zoneItems(zone: Zone): HandleDef[] {
		return zoneItems(this.nodeMap.get(zone.outputId));
	}

	private get typeResolver() {
		return this.state.graph.typeResolver;
	}

	private resolveNode = (id: string) => this.state.graph.resolveNode(id);

	incoming(nodeId: string): GraphEdge[] {
		return this.incomingByTarget.get(nodeId) ?? [];
	}

	isPresent(node: GraphNode, inputId: string): boolean {
		const edge = this.incoming(node.id).find((e) => e.targetHandle === inputId);
		if (!edge) return false;
		const source = this.nodeMap.get(edge.source);
		return !(source?.type === "group-input" && this.absentInputs.has(edge.sourceHandle));
	}

	sourceExpr(edge: GraphEdge): string {
		const sourceNode = this.nodeMap.get(edge.source);
		if (sourceNode?.type === "group-input") {
			const constant = this.constants.get(edge.sourceHandle);
			return constant === undefined
				? sanitizeIdent(edge.sourceHandle)
				: formatWgslLiteral("u32", constant);
		}
		const zoneVar = this.zoneVars.get(edge.source)?.get(edge.sourceHandle);
		if (zoneVar) return zoneVar;
		const base = getVarName(edge.source);
		if (sourceNode?.type === "node-group") return `${base}.${sanitizeIdent(edge.sourceHandle)}`;
		if (sourceNode && this.state.graph.resolveDescriptor(sourceNode).outputs.length > 1) {
			return `${base}_${edge.sourceHandle}`;
		}
		return base;
	}

	sourceType(edge: GraphEdge): WgslType {
		return this.typeResolver.inferHandleType(edge, this.resolveNode, this.bindings);
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
				return this.uniformExpr(
					`u_${identSuffix(node.id)}_${identSuffix(inputId)}`,
					target,
					value,
				);
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
			return this.uniformExpr(`u_${identSuffix(node.id)}_${identSuffix(key)}`, type, stored);
		}
		return formatWgslLiteral(type, stored);
	}

	/** Declare a uniform holding `value`, and read it as `target`. */
	private uniformExpr(name: string, target: WgslType, value: InputValue | undefined): string {
		const kind = typeKind(target);
		const components = componentKeys(target).map((c) =>
			scalarNumber(kind, readComponent(value, c)),
		);
		const [x = 0, y = 0, z = 0, w = 0] = components;
		const uniform: UniformValue =
			components.length === 1
				? x
				: components.length === 2
					? [x, y]
					: components.length === 3
						? [x, y, z]
						: [x, y, z, w];
		this.state.uniforms.set(name, uniform);
		const source = makeType("f32", components.length);
		return convertVar(`${UNIFORMS_VAR}.${name}`, source, target);
	}

	push(nodeId: string, statements: string[], indent: string) {
		const start = this.lines.length;
		for (const line of statements) this.lines.push(`${indent}${line}`);
		this.lineMap.set(nodeId, { start, end: this.lines.length });
	}

	emitNode(node: GraphNode, indent: string) {
		if (node.type === "node-group") {
			this.emitGroupCall(node, indent);
			return;
		}

		const graph = this.state.graph;
		const descriptor = graph.resolveDescriptor(node);
		const varName = getVarName(node.id);
		const incoming = this.incoming(node.id);
		const { inputTypes, outputType, resolvedInputs, resolvedOutputs } =
			this.typeResolver.resolveNodeTypes(node, incoming, this.resolveNode, this.bindings);

		const outputVars: Record<string, string> = {};
		for (const outputDef of resolvedOutputs) {
			outputVars[outputDef.id] =
				descriptor.outputs.length > 1 ? `${varName}_${outputDef.id}` : varName;
		}

		const typeOf = (id: string): WgslType => {
			const def = resolvedInputs.find((i) => i.id === id);
			return inputTypes[id] ?? (def ? inputDefaultType(def) : "f32");
		};

		// Variadic inputs are pre-converted, non-variadic ones are raw.
		const ctxInputs: Record<string, string[]> = {};
		for (const inputDef of resolvedInputs) {
			const edgesForHandle = incoming.filter((e) => e.targetHandle === inputDef.id);
			if (inputDef.variadic) {
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
		// Enum values known here are compiled into the call's function.
		const constants = groupConstants(
			this.enumDocument,
			node,
			this.state.graph.project.definitions,
			this.constants,
		);
		const resolved = this.typeResolver.resolveNodeTypes(
			node,
			this.incoming(node.id),
			this.resolveNode,
			this.bindings,
		);
		const decl = emitGroupFunction(
			this.state,
			definitionRef,
			absent,
			constants,
			resolved.bindings,
			this.readHandles.get(node.id) ?? new Set(),
		);
		if (!decl) return;
		// Converted to the function's parameters, which its body was emitted for.
		const args = descriptor.inputs.map((inputDef) =>
			this.inputExpr(
				node,
				inputDef.id,
				decl.paramTypes[inputDef.id] ?? inputDefaultType(inputDef),
				defaults?.[inputDef.id],
			),
		);
		this.push(
			node.id,
			[`let ${getVarName(node.id)} = ${decl.fnName}(${args.join(", ")});`],
			indent,
		);
	}
}

function zoneVarNames(zone: Zone, items: HandleDef[]) {
	const ident = identSuffix(zone.id);
	return {
		index: `z_${ident}_i`,
		count: `z_${ident}_n`,
		state: new Map(items.map((item, k) => [item.id, `z_${ident}_s${String(k)}`])),
		next: items.map((_, k) => `z_${ident}_next${String(k)}`),
	};
}

/**
 * Emit the nodes of a document needed to compute `seedType` nodes.
 *
 * Nodes are grouped by scope: the document's top level, then each repeat zone.
 * Within a scope, nodes and child zones are emitted in dependency order; a
 * child zone becomes a `for` loop whose body is its own scope. Loop
 * invariants live in the enclosing scope, so they are computed once before
 * the loop. Invalid links are ignored (inputs fall back to their stored
 * values).
 */
function emitDocumentBody(
	state: ShaderState,
	doc: { nodes: GraphNode[]; edges: GraphEdge[] },
	seedType: string,
	absentInputs: ReadonlySet<string> = new Set(),
	constants: ReadonlyMap<string, number> = new Map(),
	uniforms = false,
	bindings: TypeBindings = {},
	/** The seed's input handles to compute; all of them when undefined. */
	seedHandles?: ReadonlySet<string>,
): BodyEmitter {
	const nodeMap = new Map<string, GraphNode>();
	for (const node of doc.nodes) nodeMap.set(node.id, node);

	const zones = analyzeZones(doc.nodes, doc.edges);
	const validEdges = doc.edges.filter((e) => !zones.invalidEdges.has(e.id));
	const edgesByTarget = new Map<string, GraphEdge[]>();
	for (const e of validEdges)
		edgesByTarget.set(e.target, [...(edgesByTarget.get(e.target) ?? []), e]);
	const usedEdges = liveEdges(
		{ nodesById: nodeMap, edgesByTarget },
		validEdges,
		constants,
	).filter(
		(e) =>
			!seedHandles ||
			nodeMap.get(e.target)?.type !== seedType ||
			seedHandles.has(e.targetHandle),
	);
	const { edges, reachable, liveItems } = neededEdges(nodeMap, usedEdges, seedType);
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
				if (zone) emitZoneLoop(zone, indent);
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

		const setup: string[] = items.map(
			({ item, state }) =>
				`var ${state}: ${wgslTypeName(item.type)} = ${emitter.inputExpr(input, item.id, item.type)};`,
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
					`  let ${next} = ${emitter.inputExpr(output, item.id, item.type)};`,
			),
			...items.map(({ state, next }) => `  ${state} = ${next};`),
			"}",
		];
		emitter.push(zone.outputId, update, indent);
	};

	emitScope(null, "  ");
	return emitter;
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
): GroupDecl | undefined {
	const definition: HydratedGraphDocument | undefined =
		state.graph.project.definitions.get(definitionRef);
	if (!definition) return undefined;
	const variables = definition.typeVariables;
	const bindings = completeBindings(variables, given);

	const groupInputNode = definition.nodes.find((n) => n.type === "group-input");
	const inputHandles = groupInputNode?.data.handles ?? [];
	const groupOutputNode = definition.nodes.find((n) => n.type === "group-output");
	const outputHandles = groupOutputNode?.data.handles ?? [];

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
	const key = [
		definitionRef,
		...absentIndices,
		"e",
		...enumValues,
		"t",
		typeSuffix,
		"u",
		...unreadIndices,
	].join("|");
	const existing = state.groupDecls.get(key);
	if (existing) return existing;

	const ident = sanitizeIdent(definitionRef);
	const suffix = [
		...(absentIndices.length > 0 ? [`d${absentIndices.join("_")}`] : []),
		...enumValues.map((v) => `e${v}`),
		...(unreadIndices.length > 0 ? [`u${unreadIndices.join("_")}`] : []),
	];
	const fnName = [`group_${ident}`, ...suffix, ...(typeSuffix ? [`t_${typeSuffix}`] : [])].join(
		"__",
	);
	const structName = [`GroupOutputs_${ident}`, ...(typeSuffix ? [typeSuffix] : [])].join("__");

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
	);

	// Struct fields follow the handle types; whatever feeds them is converted
	// on the way in, exactly like any other typed input.
	const outputTypes = groupOutputNode
		? state.graph.typeResolver.resolveNodeTypes(
				groupOutputNode,
				definition.edgesByTarget.get(groupOutputNode.id) ?? [],
				(id) => state.graph.resolveNode(id),
				bindings,
			).inputTypes
		: {};
	const outputType = (h: GroupHandleDef): WgslType =>
		boundType(h.type, variables, bindings) ?? outputTypes[h.id] ?? "f32";
	const inputType = (h: GroupHandleDef): WgslType =>
		boundType(h.type, variables, bindings) ?? "f32";
	// Outputs the caller doesn't read keep their struct field, zeroed.
	const fieldValues = outputHandles.map((h) =>
		groupOutputNode && readHandles.has(h.id)
			? body.inputExpr(groupOutputNode, h.id, outputType(h))
			: WGSL_DEFAULTS[outputType(h)],
	);
	const structFields = outputHandles
		.map((h) => `  ${sanitizeIdent(h.id)}: ${wgslTypeName(outputType(h))},`)
		.join("\n");
	const params = inputHandles
		.map((h) => `${sanitizeIdent(h.id)}: ${wgslTypeName(inputType(h))}`)
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

	const paramTypes = Object.fromEntries(inputHandles.map((h) => [h.id, inputType(h)]));
	const entry = { decl, fnName, paramTypes };
	state.groupDecls.set(key, entry);
	return entry;
}

/**
 * Emit the full WGSL fragment shader source from the graph.
 */
export function generateShader(
	graph: CodegenGraph,
	{ uniformScopes = [] }: ShaderOptions = {},
): { shader: string; lineMap: LineMap; uniforms: Record<string, UniformValue> } {
	const state: ShaderState = {
		graph,
		helpers: new HelperRegistry(),
		groupDecls: new Map(),
		groupStructs: new Set(),
		uniformScopes: new Set(uniformScopes),
		uniforms: new Map(),
	};

	const body = emitDocumentBody(
		state,
		graph.root,
		"frag-output",
		new Set(),
		new Map(),
		state.uniformScopes.has(ROOT_ID),
	);
	const output = graph.root.nodes.find((n) => n.type === "frag-output");
	const result = output && body.lineMap.has(output.id) ? getVarName(output.id) : undefined;

	const preamble: string[] = [];
	// Every group's struct + fn, emitted once each, before frag() itself.
	for (const { decl } of state.groupDecls.values()) preamble.push(decl, "");
	const helpers = state.helpers.emit();
	if (helpers.length > 0) {
		preamble.push("// ---------- Common libraries ----------", "");
		for (const fn of helpers) preamble.push(fn, "");
	}
	preamble.push("// ---------- User code ----------", "", "fn frag(uv: vec2f) -> vec4f {");

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

	return { shader, lineMap, uniforms: Object.fromEntries(state.uniforms) };
}
