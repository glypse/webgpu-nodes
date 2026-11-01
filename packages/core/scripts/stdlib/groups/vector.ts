// Helpers generic over a float vector's width: each instance computes only
// its own width's case, so a vec2f pays for two components, not four.
import {
	type GroupBuilder,
	type GroupSpec,
	helpers,
	type Ref,
	type VariableType,
} from "../builder";

/** The widths the helpers take, scalars included. */
const WIDTHS = ["vec3f", "vec2f", "vec4f", "f32"] as const;

function vectorInput(g: GroupBuilder): { t: VariableType; vector: Ref } {
	const t = g.typeVariable("t", "T", WIDTHS);
	return { t, vector: g.input("vector", t, { label: "Vector" }) };
}

export const padVector: GroupSpec = {
	id: "std-pad-vector",
	name: "Pad to vec4f",
	aliases: ["Zero Pad", "Widen Vector", "Extend Vector", "Pad Vector"],
	category: "vector",
	...helpers(),
	build: (g) => {
		const { vector } = vectorInput(g);
		g.frame(
			"Padding",
			{
				note: "Zeros past the vector's own components:\na scalar would be spread into all four.",
			},
			() => {
				const padded = g.match(
					g.componentCount(vector),
					{ 1: g.vec("vec4f", vector, 0, 0, 0), 2: vector, 3: vector, 4: vector },
					"vec4f",
				);
				g.output("padded", padded, "vec4f", { label: "Padded" });
			},
		);
	},
};

export const componentSum: GroupSpec = {
	id: "std-component-sum",
	name: "Component Sum",
	aliases: ["Sum Components", "Add Components", "Horizontal Add", "Manhattan Length"],
	category: "vector",
	...helpers(),
	build: (g) => {
		const { vector } = vectorInput(g);
		// WGSL's dot takes no scalars.
		const dot = g.dot(vector, 1);
		const sum = g.match(g.componentCount(vector), { 1: vector, 2: dot, 3: dot, 4: dot }, "f32");
		g.output("sum", sum, "f32", { label: "Sum" });
	},
};

export const maxComponent: GroupSpec = {
	id: "std-max-component",
	name: "Max Component",
	aliases: ["Largest Component", "Horizontal Max", "Chebyshev Length"],
	category: "vector",
	...helpers(),
	build: (g) => {
		const { vector } = vectorInput(g);
		// Split padded so every width finds its components on the same node.
		const { padded } = g.call<"padded">(padVector, { vector });
		const { x, y, z, w } = g.split(padded);
		const max = g.match(
			g.componentCount(vector),
			{ 1: vector, 2: g.max(x, y), 3: g.max(x, y, z), 4: g.max(x, y, z, w) },
			"f32",
		);
		g.output("max", max, "f32", { label: "Max" });
	},
};

export default [padVector, componentSum, maxComponent];
