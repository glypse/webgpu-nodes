import type { Node } from "@xyflow/svelte";

export type FloatNodeData = { value: number };
export type FloatNodeType = Node<FloatNodeData, "float">;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AddNodeData = {};
export type AddNodeType = Node<AddNodeData, "add">;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type CombineVec4fNodeData = {};
export type CombineVec4fNodeType = Node<CombineVec4fNodeData, "combineVec4f">;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type OutputNodeData = {};
export type OutputNodeType = Node<OutputNodeData, "output">;

export type ShaderNode = FloatNodeType | AddNodeType | CombineVec4fNodeType | OutputNodeType;
