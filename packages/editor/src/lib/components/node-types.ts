import { DYNAMIC_NODE_TYPES, nodeRegistry } from "$core";

import NodeShell from "./NodeShell.svelte";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SvelteFlow node types accept any component
export const nodeTypes: Record<string, any> = {};
for (const type of [...Object.keys(nodeRegistry), ...DYNAMIC_NODE_TYPES]) {
	nodeTypes[type] = NodeShell;
}
