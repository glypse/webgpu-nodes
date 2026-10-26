import type { NodeDescriptor } from "../types";
import { convertNode } from "./builders";

export const toFloatNode: NodeDescriptor = {
	...convertNode("to-float", "To Float", "f32", false),
	aliases: ["Float", "Cast", "Convert"],
};
export const toIntNode: NodeDescriptor = {
	...convertNode("to-int", "To Integer", "i32", true),
	aliases: ["Truncate", "Cast", "Convert"],
};
export const toUintNode: NodeDescriptor = {
	...convertNode("to-uint", "To Unsigned", "u32", true),
	aliases: ["uint", "Cast", "Convert"],
};
export const toBoolNode: NodeDescriptor = {
	...convertNode("to-bool", "To Boolean", "bool", false),
	aliases: ["Cast", "Convert"],
};
