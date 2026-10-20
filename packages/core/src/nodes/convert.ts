import { convertNode } from "./builders";

export const toFloatNode = convertNode("to-float", "To Float", "f32", false);
export const toIntNode = convertNode("to-int", "To Integer", "i32", true);
export const toUintNode = convertNode("to-uint", "To Unsigned", "u32", true);
export const toBoolNode = convertNode("to-bool", "To Boolean", "bool", false);
