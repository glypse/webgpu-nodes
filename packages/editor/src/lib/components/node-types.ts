import { DYNAMIC_NODE_TYPES, LAYOUT_FRAME, nodeRegistry } from "$core";

import FrameNode from "./FrameNode.svelte";
import NodeShell from "./NodeShell.svelte";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SvelteFlow node types accept any component
export const nodeTypes: Record<string, any> = {};
for (const type of [...Object.keys(nodeRegistry), ...DYNAMIC_NODE_TYPES]) {
	nodeTypes[type] = NodeShell;
}
nodeTypes[LAYOUT_FRAME] = FrameNode;
