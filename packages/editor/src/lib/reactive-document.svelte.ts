import { type GraphEdge, type GraphNode, type HydratedGraphDocument, type Viewport } from "$core";

/**
 * Reactive document holding a subgraph's nodes, edges, and metadata: what
 * the editor's `GraphManager` hydrates documents into.
 *
 * **Why a class?** Svelte never proxies class instances, so individual node
 * properties (position, data, etc.) are plain JS objects — no deep-reactivity
 * overhead when SvelteFlow iterates over them.
 *
 * **Why `$state.raw` for nodes/edges?** SvelteFlow iterates these arrays
 * thousands of times per frame. `$state.raw` avoids the per-element proxy
 * cost of `$state` while still triggering reactivity when the array reference
 * is reassigned (e.g. `doc.nodes = [...doc.nodes, newNode]`), which is the
 * only way the model changes them.
 *
 * **Why `$state` for label/locked/viewport?** These change infrequently and
 * the UI needs granular reactivity (e.g. showing a lock icon).
 *
 * **Indexed Maps** (`nodesById`, `edgesBySource`, `edgesByTarget`) are plain
 * Maps rebuilt by the model (`indexDocument`) after every array reassignment,
 * giving O(1) lookups for node/edge queries.
 */
export class ReactiveGraphDocument implements HydratedGraphDocument {
	nodes = $state.raw<GraphNode[]>([]);
	edges = $state.raw<GraphEdge[]>([]);

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map, rebuilt on mutation
	nodesById = new Map<string, GraphNode>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map, rebuilt on mutation
	edgesBySource = new Map<string, GraphEdge[]>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map, rebuilt on mutation
	edgesByTarget = new Map<string, GraphEdge[]>();

	label = $state<string | undefined>(undefined);
	locked = $state<boolean>(false);
	viewport = $state<Viewport | undefined>(undefined);
}
