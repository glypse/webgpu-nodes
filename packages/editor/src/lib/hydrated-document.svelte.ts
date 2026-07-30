import type { Viewport } from "@xyflow/svelte";

import type { HydratedEdge } from "./graph-types";
import type { GroupedNode } from "./types";

/**
 * Reactive document holding a subgraph's nodes, edges, and metadata.
 *
 * **Why a class?** Svelte never proxies class instances, so individual node
 * properties (position, data, etc.) are plain JS objects — no deep-reactivity
 * overhead when SvelteFlow iterates over them.
 *
 * **Why `$state.raw` for nodes/edges?** SvelteFlow iterates these arrays
 * thousands of times per frame. `$state.raw` avoids the per-element proxy
 * cost of `$state` while still triggering reactivity when the array reference
 * is reassigned (e.g. `doc.nodes = [...doc.nodes, newNode]`).
 *
 * **Why `$state` for label/locked/viewport?** These change infrequently and
 * the UI needs granular reactivity (e.g. showing a lock icon).
 *
 * **Indexed Maps** (`nodesById`, `edgesBySource`, `edgesByTarget`) are plain
 * Maps rebuilt by `GraphManager.rebuildDocumentIndex()` after every array
 * reassignment, giving O(1) lookups for node/edge queries.
 */
export class HydratedGraphDocument {
	nodes = $state.raw<GroupedNode[]>([]);
	edges = $state.raw<HydratedEdge[]>([]);

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map, rebuilt on mutation
	nodesById = new Map<string, GroupedNode>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map, rebuilt on mutation
	edgesBySource = new Map<string, HydratedEdge[]>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map, rebuilt on mutation
	edgesByTarget = new Map<string, HydratedEdge[]>();

	label = $state<string | undefined>(undefined);
	locked = $state<boolean>(false);
	viewport = $state<Viewport | undefined>(undefined);
}
