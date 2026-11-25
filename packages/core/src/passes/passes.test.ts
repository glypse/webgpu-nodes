import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { generateRenderPlan, PLAN_TARGET, planPasses } from "../codegen";
import type { GraphProject } from "../graph/document";
import { GraphModel } from "../graph/model";
import { type CpuTexture, evaluate, evaluationContext } from "../testing/evaluate";
import { edge, libraryEntry, libraryHandle, rootProject } from "../testing/graph";
import { nagaBin, validatePlan } from "../testing/wgsl";

const at = { x: 0, y: 0 };

function expectValid(model: GraphModel) {
	if (nagaBin) expect(validatePlan(generateRenderPlan(model))).toEqual([]);
}

/** A group sampling its Texture input `t` 0.1 to the right of the pixel. */
function shifted(): GraphProject["definitions"][string] {
	return {
		label: "Shifted",
		inputs: [{ id: "t", label: "Texture", type: "texture" }],
		outputs: [{ id: "c", label: "Color", type: "vec4f" }],
		nodes: [
			{ id: "gin", type: "group-input", data: {}, position: at },
			{ id: "uv", type: "uv", data: {}, position: at },
			{ id: "shift", type: "add", data: {}, position: at },
			{
				id: "by",
				type: "declare",
				data: { types: { declare: "vec2f" }, values: { x: 0.1, y: 0 } },
				position: at,
			},
			{ id: "s", type: "sample-texture", data: {}, position: at },
			{ id: "gout", type: "group-output", data: {}, position: at },
		],
		edges: [
			edge(["gin", "t", "s", "texture"]),
			edge(["uv", "uv", "shift", "operands"]),
			edge(["by", "value", "shift", "operands"]),
			edge(["shift", "result", "s", "uv"]),
			edge(["s", "color", "gout", "c"]),
		],
	};
}

describe("implicit renders", () => {
	it("render a value linked to a Texture input in a pass before the frame's", () => {
		const graph = new GraphModel(
			rootProject(
				[
					{ id: "uv", type: "uv" },
					{ id: "s", type: "sample-texture" },
				],
				[
					["uv", "uv", "s", "texture"],
					["s", "color", "out", "color"],
				],
			),
		);
		const plan = generateRenderPlan(graph);
		expect(planPasses(plan.passes).map((p) => p.writes)).toEqual([
			["render:uv:uv"],
			[PLAN_TARGET],
		]);
		expect(planPasses(plan.passes)[1]?.reads).toEqual(["render:uv:uv"]);
		expect(plan.resources).toContainEqual({
			id: "render:uv:uv",
			kind: "transient",
			size: { kind: "scale", scale: 1, of: "canvas" },
			format: "rgba16float",
		});
		const link = graph.passAnalysis().link([], graph.root.edges[0] ?? edge(["", "", "", ""]));
		expect(link).toEqual({ kind: "render", id: "render:uv:uv" });
		expectValid(graph);
	});

	it("give a group used twice with other inputs a render each", () => {
		const root = rootProject(
			[
				{ id: "uv", type: "uv" },
				{ id: "time", type: "time" },
				{
					id: "ga",
					type: "node-group",
					group: { definitionRef: "shifted", locked: false },
				},
				{
					id: "gb",
					type: "node-group",
					group: { definitionRef: "shifted", locked: false },
				},
				{ id: "sum", type: "add" },
			],
			[
				["uv", "uv", "ga", "t"],
				["time", "seconds", "gb", "t"],
				["ga", "c", "sum", "operands"],
				["gb", "c", "sum", "operands"],
				["sum", "result", "out", "color"],
			],
		);
		root.definitions.shifted = shifted();
		const graph = new GraphModel(root);
		expect([...graph.passAnalysis().renders().keys()].toSorted()).toEqual([
			"render:time:seconds",
			"render:uv:uv",
		]);
		expect(planPasses(generateRenderPlan(graph).passes)).toHaveLength(3);
		expectValid(graph);
	});

	it("can't render a value computed in a repeat zone", () => {
		const graph = new GraphModel(rootProject([], []));
		const zone = graph.createRepeatZone(at) ?? "";
		const output = graph.root.nodesById.get(zone)?.data.pairedOutput ?? "";
		const item = graph.getZoneItems(zone)[0]?.id ?? "";
		const sample = graph.addNode("sample-texture", at) ?? "";
		graph.connect({
			source: zone,
			sourceHandle: item,
			target: sample,
			targetHandle: "texture",
		});
		graph.connect({
			source: sample,
			sourceHandle: "color",
			target: output,
			targetHandle: item,
		});
		graph.connect({ source: output, sourceHandle: item, target: "out", targetHandle: "color" });
		const into = graph.root.edges.find((e) => e.target === sample);
		const link = into && graph.passAnalysis().link([], into);
		expect(link?.kind).toBe("invalid");
		expect(planPasses(generateRenderPlan(graph).passes)).toHaveLength(1);
		expectValid(graph);
	});

	it("can render a zone's final value", () => {
		const graph = new GraphModel(rootProject([], []));
		const zone = graph.createRepeatZone(at) ?? "";
		const output = graph.root.nodesById.get(zone)?.data.pairedOutput ?? "";
		const item = graph.getZoneItems(zone)[0]?.id ?? "";
		const sample = graph.addNode("sample-texture", at) ?? "";
		graph.connect({
			source: output,
			sourceHandle: item,
			target: sample,
			targetHandle: "texture",
		});
		graph.connect({
			source: sample,
			sourceHandle: "color",
			target: "out",
			targetHandle: "color",
		});
		expect(planPasses(generateRenderPlan(graph).passes)).toHaveLength(2);
		expectValid(graph);
	});

	it("pick a texture by an index known while compiling, and by no other", () => {
		const image = (id: string): Asset => ({ ...IMPULSE, id, hash: id });
		const project = (index: "linked" | number): GraphProject => ({
			...rootProject(
				[
					{ id: "a", type: "image", data: { asset: "a" } },
					{ id: "b", type: "image", data: { asset: "b" } },
					{ id: "i", type: "declare", data: { types: { declare: "i32" } } },
					{
						id: "pick",
						type: "index-switch",
						data: index === "linked" ? {} : { values: { index } },
					},
					{ id: "s", type: "sample-texture" },
				],
				[
					["a", "texture", "pick", "case-0"],
					["b", "texture", "pick", "case-1"],
					...(index === "linked" ? [["i", "value", "pick", "index"] as const] : []),
					["pick", "result", "s", "texture"],
					["s", "color", "out", "color"],
				].map((e) => [...e] as [string, string, string, string]),
			),
			assets: [image("a"), image("b")],
		});
		const known = generateRenderPlan(new GraphModel(project(1)));
		expect(known.resources.map((r) => r.id)).toEqual(["media:b"]);
		const unknown = new GraphModel(project("linked"));
		const into = unknown.root.edges.find((e) => e.target === "s");
		expect(into && unknown.passAnalysis().link([], into)?.kind).toBe("invalid");
		expect(generateRenderPlan(unknown).resources.map((r) => r.id)).toEqual(["empty"]);
		expectValid(unknown);
	});
});

/** A square transparent image of `size` pixels, opaque white at its centre. */
function impulse(size: number): CpuTexture {
	const centre = (size - 1) / 2;
	return {
		width: size,
		height: size,
		texel: (x, y) => (x === centre && y === centre ? [1, 1, 1, 1] : [0, 0, 0, 0]),
	};
}

const SIZE = 9;

const IMPULSE: Asset = {
	kind: "image",
	id: "impulse",
	name: "impulse",
	file: "assets/images/impulse.png",
	mime: "image/png",
	bytes: 1,
	hash: "impulse",
	width: SIZE,
	height: SIZE,
};

/** The image blurred by the standard-library group `id` at `radius` pixels, its alpha by pixel. */
function blurred(id: string, radius: number, values: Record<string, number> = {}): number[][] {
	const alphaAt = blurAlpha(id, radius, values);
	return Array.from({ length: SIZE }, (_, y) =>
		Array.from({ length: SIZE }, (_, x) => alphaAt(x, y)),
	);
}

/** Like `blurred`, one pixel at a time. */
function blurAlpha(
	id: string,
	radius: number,
	values: Record<string, number> = {},
): (x: number, y: number) => number {
	const entry = libraryEntry(id);
	const asset = IMPULSE;
	const project = rootProject(
		[
			{ id: "img", type: "image", data: { asset: asset.id } },
			{
				id: "blur",
				type: "node-group",
				group: { definitionRef: entry.ref, locked: true },
				data: {
					values: {
						[libraryHandle(entry, "group-input", "Radius")]: radius / SIZE,
						...Object.fromEntries(
							Object.entries(values).map(([label, value]) => [
								libraryHandle(entry, "group-input", label),
								value,
							]),
						),
					},
				},
			},
			// Samples the blurred texture at the pixel, for the evaluator to read.
			{ id: "read", type: "add" },
		],
		[
			["img", "texture", "blur", libraryHandle(entry, "group-input", "Texture")],
			["blur", libraryHandle(entry, "group-output", "Texture"), "read", "operands"],
			["read", "result", "out", "color"],
		],
	);
	const graph = new GraphModel({ ...project, assets: [asset] });
	expectValid(graph);
	const images = new Map([[asset.id, impulse(SIZE)]]);
	const context = evaluationContext(graph, images);
	return (x, y) => {
		const uv = [(x + 0.5) / SIZE, 1 - (y + 0.5) / SIZE] as const;
		const [r = 0, , , a = 0] = evaluate(graph, "read", "result", "srgb", [SIZE, SIZE], {
			uv,
			context,
		});
		// Premultiplied while blurred: white stays white wherever it shows.
		if (a > 0.001) expect(r).toBeCloseTo(1, 4);
		return a;
	};
}

/** `weight`'s separable kernel around the centre, normalised. */
function reference(weight: (k: number) => number, reach: number): number[][] {
	const centre = (SIZE - 1) / 2;
	let sum = 0;
	for (let k = -reach; k <= reach; k++) sum += weight(k);
	const w = (d: number) => (Math.abs(d) <= reach ? weight(d) / sum : 0);
	return Array.from({ length: SIZE }, (_, y) =>
		Array.from({ length: SIZE }, (_, x) => w(x - centre) * w(y - centre)),
	);
}

function expectClose(actual: number[][], expected: number[][]) {
	actual.forEach((row, y) => {
		row.forEach((value, x) => {
			expect(value, `pixel ${String(x)}, ${String(y)}`).toBeCloseTo(expected[y]?.[x] ?? 0, 4);
		});
	});
}

// The evaluator computes every tap of every pass on the CPU.
const SLOW = 30_000;

describe("blurs", () => {
	it("Gaussian Blur weights taps by a Gaussian of a third of the radius", () => {
		const radius = 3;
		const sigma = radius / 3;
		expectClose(
			blurred("std-gaussian-blur", radius),
			reference(
				(k) =>
					Math.max(
						Math.exp(-(k * k) / (2 * sigma * sigma)) -
							Math.exp(-((radius + 1) ** 2) / (2 * sigma * sigma)),
						0,
					),
				radius,
			),
		);
	});

	it("Box Blur weights taps equally, the outermost by the radius' fraction", () => {
		const radius = 1.5;
		expectClose(
			blurred("std-box-blur", radius),
			reference((k) => Math.min(1, Math.max(0, radius + 1 - Math.abs(k))), Math.ceil(radius)),
		);
	});

	it("blurs along the angle alone with a direction", () => {
		const centre = (SIZE - 1) / 2;
		for (const id of ["std-gaussian-blur", "std-box-blur"]) {
			const pixels = blurred(id, 2, { Direction: 1, Angle: 90 });
			pixels.forEach((row, y) => {
				row.forEach((value, x) => {
					if (x !== centre) expect(value).toBeCloseTo(0, 4);
					else if (y === centre) expect(value).toBeGreaterThan(0);
				});
			});
			expect(pixels[centre - 1]?.[centre]).toBeGreaterThan(0);
		}
	});

	it(
		"Box Blur's iterations repeat the blur, as often as they're asked",
		() => {
			const centre = (SIZE - 1) / 2;
			// A radius of one pixel is three equal taps along each axis, an edge's
			// clamped to its pixel.
			const after = (iterations: number) => {
				let line: number[] = Array.from({ length: SIZE }, (_, i) => (i === centre ? 1 : 0));
				for (let n = 0; n < iterations; n++) {
					const was = line;
					line = was.map(
						(v, i) =>
							(v +
								(was[Math.max(0, i - 1)] ?? 0) +
								(was[Math.min(SIZE - 1, i + 1)] ?? 0)) /
							3,
					);
				}
				return line;
			};
			for (const iterations of [1, 2, 3]) {
				const line = after(iterations);
				expectClose(
					blurred("std-box-blur", 1, { Iterations: iterations }),
					Array.from({ length: SIZE }, (_, y) =>
						Array.from({ length: SIZE }, (_, x) => (line[x] ?? 0) * (line[y] ?? 0)),
					),
				);
			}
			const line = after(20);
			expectClose(
				blurred("std-box-blur", 1, { Iterations: 20 }),
				Array.from({ length: SIZE }, (_, y) =>
					Array.from({ length: SIZE }, (_, x) => (line[x] ?? 0) * (line[y] ?? 0)),
				),
			);
		},
		SLOW,
	);

	it(
		"blurs the same unseparated, at a radius the same across the image",
		() => {
			for (const id of ["std-gaussian-blur", "std-box-blur"]) {
				expectClose(blurred(id, 2, { Separable: 0 }), blurred(id, 2));
			}
		},
		SLOW,
	);

	it("renders only the passes its settings reach", () => {
		const passes = (id: string, values: Record<string, number>) => {
			const entry = libraryEntry(id);
			const project = rootProject(
				[
					{ id: "img", type: "image", data: { asset: IMPULSE.id } },
					{
						id: "blur",
						type: "node-group",
						group: { definitionRef: entry.ref, locked: true },
						data: {
							values: Object.fromEntries(
								Object.entries(values).map(([label, value]) => [
									libraryHandle(entry, "group-input", label),
									value,
								]),
							),
						},
					},
					{ id: "read", type: "add" },
				],
				[
					["img", "texture", "blur", libraryHandle(entry, "group-input", "Texture")],
					["blur", libraryHandle(entry, "group-output", "Texture"), "read", "operands"],
					["read", "result", "out", "color"],
				],
			);
			const graph = new GraphModel({ ...project, assets: [IMPULSE] });
			return planPasses(generateRenderPlan(graph).passes).length;
		};
		// The last pass samples the blur's result.
		expect(passes("std-gaussian-blur", {})).toBe(3);
		expect(passes("std-gaussian-blur", { Direction: 1 })).toBe(2);
		// The iterations are a loop's, not passes of their own.
		expect(passes("std-box-blur", { Iterations: 3 })).toBe(5);
		expect(passes("std-box-blur", { Iterations: 20 })).toBe(5);
		expect(passes("std-box-blur", { Iterations: 3, Direction: 1 })).toBe(4);
		expect(passes("std-gaussian-blur", { Separable: 0 })).toBe(2);
	});
});
