import type { Node } from "@xyflow/svelte";

import type { GraphManager } from "./graph-state.svelte";
import { ROOT_ID, type HydratedEdge } from "./graph-types";
import type { HydratedGraphDocument } from "./hydrated-document.svelte";
import type { GroupedNode, HandleDef, ScalarKind, WgslType } from "./types";
import {
	WGSL_DEFAULTS,
	convertVar,
	inputDefaultType,
	typeComponents,
	typeKind,
	wgslTypeName,
} from "./types";
import { HelperRegistry } from "./wgsl-helpers";
import {
	DEFAULT_ITERATIONS,
	ITERATIONS_HANDLE,
	ITERATION_HANDLE,
	REPEAT_INPUT,
	type Zone,
	type ZoneAnalysis,
	analyzeZones,
	pairedOutputId,
	zoneItems,
	zoneMaxIterations,
} from "./zones";

// ── Literals ─────────────────────────────────────────────────────────────────

const SCALAR_LIMITS = {
	i32: { min: -2147483647, max: 2147483647 },
	u32: { min: 0, max: 4294967295 },
};

/** Format a stored data value as a WGSL scalar literal of the given kind. */
function scalarLiteral(kind: ScalarKind, value: unknown): string {
	if (kind === "bool") {
		const truthy =
			value === true || value === "true" || (typeof value === "number" && value !== 0);
		return truthy ? "true" : "false";
	}
	const raw = Number(value);
	const n = Number.isFinite(raw) ? raw : 0;
	if (kind === "f32") return `f32(${String(n)})`;
	const { min, max } = SCALAR_LIMITS[kind];
	const int = Math.min(max, Math.max(min, Math.trunc(n)));
	return `${kind}(${String(int)})`;
}

const LITERAL_COMPONENTS = ["x", "y", "z", "w"];

/**
 * Format a stored data value as a WGSL literal for a given type. Vectors are
 * stored as `{ x, y, z, w }` objects; a plain scalar fills every component
 * (the editor UI shows it the same way).
 */
export function formatWgslLiteral(type: WgslType, value: unknown): string {
	const kind = typeKind(type);
	const components = typeComponents(type);
	if (components === 1) {
		if (typeof value === "object" && value !== null) {
			return scalarLiteral(kind, (value as Record<string, unknown>).x);
		}
		return scalarLiteral(kind, value);
	}
	if (value === undefined || value === null) return WGSL_DEFAULTS[type];
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const parts = LITERAL_COMPONENTS.slice(0, components).map((c) =>
			scalarLiteral(kind, obj[c]),
		);
		return `${wgslTypeName(type)}(${parts.join(", ")})`;
	}
	return `${wgslTypeName(type)}(${scalarLiteral(kind, value)})`;
}

// ── Graph walking ────────────────────────────────────────────────────────────

/**
 * Walk backwards from seed-type nodes through edges to find all node IDs
 * that contribute to the final output. `seedType` is "frag-output" at root,
 * "group-output" inside any group's own subgraph. A Repeat Output implicitly
 * depends on its Repeat Input.
 */
function findReachableNodeIds(
	nodes: Map<string, Node>,
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

function stripLabels(data: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(data)) {
		if (k === "handles" && Array.isArray(v)) {
			out[k] = v.map((h): { id: string; type: string } => {
				if (typeof h === "object" && h !== null && "id" in h && "type" in h) {
					const handle = h as { id: string; type: string };
					return { id: handle.id, type: handle.type };
				}
				return { id: "", type: "" };
			});
		} else {
			out[k] = v;
		}
	}
	return out;
}

function hashDoc(doc: { nodes: Node[]; edges: HydratedEdge[] }) {
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
	definitions: Map<string, { nodes: Node[]; edges: HydratedEdge[] }>;
}): string {
	const root = project.definitions.get(ROOT_ID);
	if (!root) return "";

	const nodeMap = new Map<string, GroupedNode>();
	for (const node of root.nodes) nodeMap.set(node.id, node);
	const reachableRootIds = findReachableNodeIds(nodeMap, root.edges, "frag-output");

	const visitedGroupDefs = new Set<string>();
	const defQueue: string[] = [];
	const visit = (node: GroupedNode) => {
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

/** The slice of the GraphManager that code generation depends on. */
export type CodegenGraph = Pick<
	GraphManager,
	"root" | "project" | "typeResolver" | "resolveDescriptor" | "resolveNode"
>;

type LineMap = Map<string, { start: number; end: number }>;

/** Everything shared while generating one shader. */
type ShaderState = {
	graph: CodegenGraph;
	helpers: HelperRegistry;
	/**
	 * Every group's generated function (and, for the first one, its output
	 * struct), keyed by definitionRef plus the absent fallback inputs, so each
	 * variant is emitted once no matter how many instances use it.
	 */
	groupDecls: Map<string, { decl: string; fnName: string }>;
	/** Definitions whose output struct has already been declared. */
	groupStructs: Set<string>;
};

/**
 * Emits the body of one document (the root fragment or a group function).
 * Expressions for node outputs are resolved through `sourceExpr`, conversions
 * through the TypeResolver's per-handle types.
 */
class BodyEmitter {
	readonly lines: string[] = [];
	readonly lineMap: LineMap = new Map();
	private nodeMap = new Map<string, GroupedNode>();
	private incomingByTarget = new Map<string, HydratedEdge[]>();
	/** WGSL variables standing for zone boundary outputs, keyed by node id then handle id. */
	private zoneVars = new Map<string, Map<string, string>>();

	constructor(
		private state: ShaderState,
		doc: { nodes: GroupedNode[] },
		edges: HydratedEdge[],
		readonly zones: ZoneAnalysis,
		/** Group-input handles the calling group node left unlinked (absent values). */
		private absentInputs: ReadonlySet<string> = new Set(),
	) {
		for (const node of doc.nodes) this.nodeMap.set(node.id, node);
		for (const edge of edges) {
			const list = this.incomingByTarget.get(edge.target) ?? [];
			list.push(edge);
			this.incomingByTarget.set(edge.target, list);
		}
		for (const zone of zones.zones.values()) {
			const vars = zoneVarNames(zone, this.zoneItems(zone));
			const inputVars = new Map(vars.state);
			inputVars.set(ITERATION_HANDLE, vars.index);
			this.zoneVars.set(zone.inputId, inputVars);
			this.zoneVars.set(zone.outputId, vars.state);
		}
	}

	node(id: string): GroupedNode | undefined {
		return this.nodeMap.get(id);
	}

	zoneItems(zone: Zone): HandleDef[] {
		return zoneItems(this.nodeMap.get(zone.outputId));
	}

	private get typeResolver() {
		return this.state.graph.typeResolver;
	}

	private resolveNode = (id: string) => this.state.graph.resolveNode(id);

	incoming(nodeId: string): HydratedEdge[] {
		return this.incomingByTarget.get(nodeId) ?? [];
	}

	/** Whether `node`'s input `inputId` carries a value (see `WgslCtx.isPresent`). */
	isPresent(node: GroupedNode, inputId: string): boolean {
		const edge = this.incoming(node.id).find((e) => e.targetHandle === inputId);
		if (!edge) return false;
		const source = this.nodeMap.get(edge.source);
		return !(source?.type === "group-input" && this.absentInputs.has(edge.sourceHandle));
	}

	/** The WGSL expression holding the value of an edge's source handle. */
	sourceExpr(edge: HydratedEdge): string {
		const sourceNode = this.nodeMap.get(edge.source);
		if (sourceNode?.type === "group-input") return sanitizeIdent(edge.sourceHandle);
		const zoneVar = this.zoneVars.get(edge.source)?.get(edge.sourceHandle);
		if (zoneVar) return zoneVar;
		const base = getVarName(edge.source);
		if (sourceNode?.type === "node-group") return `${base}.${sanitizeIdent(edge.sourceHandle)}`;
		if (sourceNode && this.state.graph.resolveDescriptor(sourceNode).outputs.length > 1) {
			return `${base}_${edge.sourceHandle}`;
		}
		return base;
	}

	/** The type carried by an edge's source handle. */
	sourceType(edge: HydratedEdge): WgslType {
		return this.typeResolver.inferHandleType(edge, this.resolveNode);
	}

	/** The source expression of an edge, converted to `target`. */
	convertedSource(edge: HydratedEdge, target: WgslType): string {
		return convertVar(this.sourceExpr(edge), this.sourceType(edge), target);
	}

	/**
	 * The value fed to `node`'s input `inputId`, as an expression of type
	 * `target`: the connected source (converted) or the node's stored literal.
	 */
	inputExpr(node: GroupedNode, inputId: string, target: WgslType, fallback?: unknown): string {
		const edge = this.incoming(node.id).find((e) => e.targetHandle === inputId);
		if (edge) return this.convertedSource(edge, target);
		return formatWgslLiteral(target, node.data[inputId] ?? fallback);
	}

	push(nodeId: string, statements: string[], indent: string) {
		const start = this.lines.length;
		for (const line of statements) this.lines.push(`${indent}${line}`);
		this.lineMap.set(nodeId, { start, end: this.lines.length });
	}

	/** Emit the statements computing one ordinary or group node. */
	emitNode(node: GroupedNode, indent: string) {
		if (node.type === "node-group") {
			this.emitGroupCall(node, indent);
			return;
		}

		const graph = this.state.graph;
		const descriptor = graph.resolveDescriptor(node);
		const varName = getVarName(node.id);
		const incoming = this.incoming(node.id);
		const { inputTypes, outputType, resolvedInputs, resolvedOutputs } =
			this.typeResolver.resolveNodeTypes(node, incoming, this.resolveNode);

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
			return this.inputExpr(node, id, typeOf(id), descriptor.defaultData[id]);
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
		});
		this.push(node.id, statements, indent);
	}

	private emitGroupCall(node: GroupedNode, indent: string) {
		const definitionRef = node.group?.definitionRef;
		if (!definitionRef) return;
		const descriptor = this.state.graph.resolveDescriptor(node);
		// Fallback inputs this call leaves without a value pick the group's own default.
		const absent = new Set(
			descriptor.inputs
				.filter((i) => i.fallback && !this.isPresent(node, i.id))
				.map((i) => i.id),
		);
		const decl = emitGroupFunction(this.state, definitionRef, absent);
		if (!decl) return;
		const args = descriptor.inputs.map((inputDef) =>
			this.inputExpr(node, inputDef.id, inputDefaultType(inputDef)),
		);
		this.push(
			node.id,
			[`let ${getVarName(node.id)} = ${decl.fnName}(${args.join(", ")});`],
			indent,
		);
	}
}

/** Names of the WGSL variables a zone's loop uses. */
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
 * Nodes are grouped by scope: the document's top level, then each repeat zone
 * (see `analyzeZones`). Within a scope, nodes and child zones are emitted in
 * dependency order; a child zone becomes a `for` loop whose body is its own
 * scope. Loop invariants live in the enclosing scope, so they are computed
 * once before the loop. Invalid links are ignored (inputs fall back to their
 * stored values).
 */
function emitDocumentBody(
	state: ShaderState,
	doc: { nodes: GroupedNode[]; edges: HydratedEdge[] },
	seedType: string,
	absentInputs: ReadonlySet<string> = new Set(),
): BodyEmitter {
	const nodeMap = new Map<string, GroupedNode>();
	for (const node of doc.nodes) nodeMap.set(node.id, node);

	const zones = analyzeZones(doc.nodes, doc.edges);
	const validEdges = doc.edges.filter((e) => !zones.invalidEdges.has(e.id));
	const reachable = findReachableNodeIds(nodeMap, validEdges, seedType);
	const edges = validEdges.filter((e) => reachable.has(e.source) && reachable.has(e.target));
	const emitter = new BodyEmitter(state, doc, edges, zones, absentInputs);

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
		const items = emitter.zoneItems(zone);
		const vars = zoneVarNames(zone, items);
		const stateVar = (k: number) => [...vars.state.values()][k] ?? "";

		const setup: string[] = items.map(
			(item, k) =>
				`var ${stateVar(k)}: ${wgslTypeName(item.type)} = ${emitter.inputExpr(input, item.id, item.type)};`,
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
				(item, k) =>
					`  let ${vars.next[k] ?? ""} = ${emitter.inputExpr(output, item.id, item.type)};`,
			),
			...items.map((_, k) => `  ${stateVar(k)} = ${vars.next[k] ?? ""};`),
			"}",
		];
		emitter.push(zone.outputId, update, indent);
	};

	emitScope(null, "  ");
	return emitter;
}

/**
 * Generate one group's `struct` + `fn` (recursively for nested groups).
 * Memoized per definitionRef.
 */
function emitGroupFunction(
	state: ShaderState,
	definitionRef: string,
	absentInputs: ReadonlySet<string> = new Set(),
): { decl: string; fnName: string } | undefined {
	const definition: HydratedGraphDocument | undefined =
		state.graph.project.definitions.get(definitionRef);
	if (!definition) return undefined;

	const groupInputNode = definition.nodes.find((n) => n.type === "group-input");
	const inputHandles = (groupInputNode?.data.handles ?? []) as HandleDef[];

	// One function per combination of absent fallback inputs, so each only
	// contains the branches it uses: `group_x` with everything linked,
	// `group_x__d0_2` when inputs 0 and 2 fall back to the group's defaults.
	const absentIndices = inputHandles.flatMap((h, i) => (absentInputs.has(h.id) ? [i] : []));
	const key = [definitionRef, ...absentIndices].join("|");
	const existing = state.groupDecls.get(key);
	if (existing) return existing;

	const ident = sanitizeIdent(definitionRef);
	const fnName =
		absentIndices.length > 0 ? `group_${ident}__d${absentIndices.join("_")}` : `group_${ident}`;
	const structName = `GroupOutputs_${ident}`;

	const groupOutputNode = definition.nodes.find((n) => n.type === "group-output");
	const outputHandles = (groupOutputNode?.data.handles ?? []) as HandleDef[];

	const body = emitDocumentBody(state, definition, "group-output", absentInputs);

	// Struct fields follow the declared handle types; whatever feeds them is
	// converted on the way in, exactly like any other typed input.
	const fieldValues = outputHandles.map((h) =>
		groupOutputNode ? body.inputExpr(groupOutputNode, h.id, h.type) : WGSL_DEFAULTS[h.type],
	);
	const structFields = outputHandles
		.map((h) => `  ${sanitizeIdent(h.id)}: ${wgslTypeName(h.type)},`)
		.join("\n");
	const params = inputHandles
		.map((h) => `${sanitizeIdent(h.id)}: ${wgslTypeName(h.type)}`)
		.join(", ");

	// Every specialisation of a definition shares one output struct.
	const firstOfDefinition = !state.groupStructs.has(definitionRef);
	state.groupStructs.add(definitionRef);
	const decl = [
		...(firstOfDefinition ? [`struct ${structName} {\n${structFields}\n}`, ""] : []),
		`fn ${fnName}(${params}) -> ${structName} {`,
		...body.lines,
		`  return ${structName}(${fieldValues.join(", ")});`,
		`}`,
	].join("\n");

	const entry = { decl, fnName };
	state.groupDecls.set(key, entry);
	return entry;
}

/**
 * Emit the full WGSL fragment shader source from the graph.
 */
export function generateShader(graph: CodegenGraph): { shader: string; lineMap: LineMap } {
	const state: ShaderState = {
		graph,
		helpers: new HelperRegistry(),
		groupDecls: new Map(),
		groupStructs: new Set(),
	};

	const body = emitDocumentBody(state, graph.root, "frag-output");
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

	return { shader, lineMap };
}
