import type { GraphDocumentEdge } from "../graph/document";
import {
	type EnumVariant,
	type GroupHandleDef,
	type NodeData,
	typeComponents,
	type WgslType,
} from "../types";

export const MATCH = "match";
export const MATCH_SELECTOR = "selector";

export const COMPONENT_COUNT = "component-count";
export const COMPONENT_COUNT_INPUT = "value";

/** The enum a Component Count node's output carries: one variant per width. */
export const COMPONENT_COUNTS: readonly EnumVariant[] = [
	{ value: 1, label: "Scalar" },
	{ value: 2, label: "Vector 2" },
	{ value: 3, label: "Vector 3" },
	{ value: 4, label: "Vector 4" },
];

const CASE_PREFIX = "case-";

/** The input of a Match node taking the value of one variant. */
export function caseHandle(value: number): string {
	return `${CASE_PREFIX}${String(value)}`;
}

export function isCaseHandle(handleId: string): boolean {
	return handleId.startsWith(CASE_PREFIX);
}

/** A value for a new variant: one no variant of `variants` has. */
export function nextVariantValue(variants: readonly EnumVariant[]): number {
	return variants.reduce((max, v) => Math.max(max, v.value + 1), 0);
}

/** What enum tracing reads of a document. */
export type EnumDocument = {
	nodesById: ReadonlyMap<string, { type?: string; data: NodeData }>;
	edgesByTarget: ReadonlyMap<string, readonly GraphDocumentEdge[]>;
	/** The inputs of the group the document is, which its Group Input nodes show. */
	inputs: readonly GroupHandleDef[];
	/**
	 * The type an input of a node resolves to, for values computed from
	 * types (Component Count). Without it those values aren't known.
	 */
	inputType?: (nodeId: string, inputId: string) => WgslType | undefined;
};

/** Node types forwarding one input's value unchanged, by that input's id. */
const PASS_THROUGH: Readonly<Record<string, string>> = { reroute: "in" };

function feed(doc: EnumDocument, nodeId: string, inputId: string) {
	return doc.edgesByTarget.get(nodeId)?.find((e) => e.targetHandle === inputId);
}

/**
 * The enum an output carries: that of a group input's enum handle or a
 * Component Count node, through nodes passing values unchanged. Undefined
 * for any other value.
 */
export function enumOfOutput(
	doc: EnumDocument,
	nodeId: string,
	handleId: string,
): readonly EnumVariant[] | undefined {
	const node = doc.nodesById.get(nodeId);
	if (node?.type === "group-input") {
		return doc.inputs.find((h) => h.id === handleId)?.variants;
	}
	if (node?.type === COMPONENT_COUNT) return COMPONENT_COUNTS;
	const through = PASS_THROUGH[node?.type ?? ""];
	return through ? enumAt(doc, nodeId, through) : undefined;
}

/** The enum linked to an input, if any. */
export function enumAt(
	doc: EnumDocument,
	nodeId: string,
	inputId: string,
): readonly EnumVariant[] | undefined {
	const edge = feed(doc, nodeId, inputId);
	return edge && enumOfOutput(doc, edge.source, edge.sourceHandle);
}

/**
 * The value an input has while compiling, when it comes from a group input
 * whose value is known (`constants` holds those, by handle id) or from a
 * Component Count node.
 */
export function constantAt(
	doc: EnumDocument,
	nodeId: string,
	inputId: string,
	constants: ReadonlyMap<string, number>,
): number | undefined {
	const edge = feed(doc, nodeId, inputId);
	if (!edge) return undefined;
	const source = doc.nodesById.get(edge.source);
	if (source?.type === "group-input") return constants.get(edge.sourceHandle);
	if (source?.type === COMPONENT_COUNT) {
		const type = doc.inputType?.(edge.source, COMPONENT_COUNT_INPUT);
		return type && typeComponents(type);
	}
	const through = PASS_THROUGH[source?.type ?? ""];
	return through ? constantAt(doc, edge.source, through, constants) : undefined;
}

/**
 * The case input a Match node uses while compiling, when its enum's value is
 * known. A value matching no variant picks the first one, as it does in the
 * shader.
 */
export function matchedCase(
	doc: EnumDocument,
	nodeId: string,
	constants: ReadonlyMap<string, number>,
): string | undefined {
	const value = constantAt(doc, nodeId, MATCH_SELECTOR, constants);
	if (value === undefined) return undefined;
	const variants = enumAt(doc, nodeId, MATCH_SELECTOR) ?? [];
	const variant = variants.find((v) => v.value === value) ?? variants[0];
	return variant && caseHandle(variant.value);
}

/**
 * `edges` without those whose value is never used while compiling with
 * `constants`: links into the cases a Match node doesn't pick.
 */
export function liveEdges<E extends GraphDocumentEdge>(
	doc: EnumDocument,
	edges: readonly E[],
	constants: ReadonlyMap<string, number>,
): E[] {
	const picked = new Map<string, string | undefined>();
	return edges.filter((e) => {
		if (!isCaseHandle(e.targetHandle) || doc.nodesById.get(e.target)?.type !== MATCH) {
			return true;
		}
		if (!picked.has(e.target)) picked.set(e.target, matchedCase(doc, e.target, constants));
		const chosen = picked.get(e.target);
		return chosen === undefined || chosen === e.targetHandle;
	});
}
