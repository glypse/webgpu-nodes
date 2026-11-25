import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import {
	generateRenderPlan,
	generateShader,
	type LoopDecl,
	PLAN_TARGET,
	planLoops,
	type PlanNode,
	planPasses,
	type RenderPlan,
} from "../codegen";
import { evaluateFrame, frameDependencies } from "../frame/program";
import type { GraphDocumentNode, GraphProject } from "../graph/document";
import { GraphModel } from "../graph/model";
import { type CpuTexture, evaluate } from "../testing/evaluate";
import { edge, rootProject, type TestEdge, type TestNode } from "../testing/graph";
import { fragmentOf, nagaBin, validateFragment, validatePlan } from "../testing/wgsl";
import type { NodeData, ZoneItem } from "../types";
import { loopReadId, loopTextureId } from "./loop";

const at = { x: 0, y: 0 };

const IMG: ZoneItem = { id: "img", label: "Image", type: "texture" };
const ACC: ZoneItem = { id: "acc", label: "Accumulator", type: "f32" };

const image: Asset = {
	kind: "image",
	id: "a",
	name: "a",
	file: "assets/images/a.png",
	mime: "image/png",
	bytes: 1,
	hash: "a",
	width: 4,
	height: 4,
};

/** A texel per column of its x, in red. */
const ramp: CpuTexture = { width: 4, height: 4, texel: (x) => [x, 0, 0, 1] };
const images = new Map([["a", ramp]]);

function loop(
	id: string,
	items: ZoneItem[],
	iterations: number | "linked" = 3,
	data: NodeData = {},
): TestNode[] {
	return [
		{
			id: `${id}_in`,
			type: "pass-repeat-input",
			data: {
				pairedOutput: `${id}_out`,
				...(iterations === "linked" ? {} : { values: { iterations } }),
				...data,
			},
		},
		{ id: `${id}_out`, type: "pass-repeat-output", data: { items } },
	];
}

/**
 * What `id`'s image item becomes: the mean of the pixel and the one to its
 * right (a texel on a 4 wide image), sampled from its current value.
 */
function blur(id: string): [TestNode[], TestEdge[]] {
	return [
		[
			{ id: `${id}_uv`, type: "uv" },
			{ id: `${id}_shift`, type: "add" },
			{
				id: `${id}_by`,
				type: "declare",
				data: { types: { declare: "vec2f" }, values: { x: 0.25 } },
			},
			{ id: `${id}_here`, type: "sample-texture" },
			{ id: `${id}_right`, type: "sample-texture" },
			{ id: `${id}_sum`, type: "add" },
			{ id: `${id}_half`, type: "mul" },
			{ id: `${id}_k`, type: "declare", data: { values: { x: 0.5 } } },
		],
		[
			[`${id}_uv`, "uv", `${id}_shift`, "operands"],
			[`${id}_by`, "value", `${id}_shift`, "operands"],
			[`${id}_in`, "img", `${id}_here`, "texture"],
			[`${id}_in`, "img", `${id}_right`, "texture"],
			[`${id}_shift`, "result", `${id}_right`, "uv"],
			[`${id}_here`, "color", `${id}_sum`, "operands"],
			[`${id}_right`, "color", `${id}_sum`, "operands"],
			[`${id}_sum`, "result", `${id}_half`, "operands"],
			[`${id}_k`, "value", `${id}_half`, "operands"],
			[`${id}_half`, "result", `${id}_out`, "img"],
		],
	];
}

/** The frame is the red of `from`'s image item, as a texture. */
const viewed = (from: string): [TestNode[], TestEdge[]] => [
	[{ id: "view", type: "sample-texture" }],
	[
		[from, "img", "view", "texture"],
		["view", "color", "out", "color"],
	],
];

/** A blur of `a`'s image, `iterations` times, viewed as the frame. */
function blurred(iterations: number): GraphModel {
	const [bn, be] = blur("p");
	const [vn, ve] = viewed("p_out");
	return new GraphModel({
		...rootProject(
			[
				...loop("p", [IMG], iterations),
				{ id: "img", type: "image", data: { asset: "a" } },
				...bn,
				...vn,
			],
			[["img", "texture", "p_in", "img"], ...be, ...ve],
		),
		assets: [image],
	});
}

function valid(plan: RenderPlan) {
	if (nagaBin) expect(validatePlan(plan)).toEqual([]);
	return plan;
}

const kinds = (nodes: readonly PlanNode[]) => nodes.map((n) => n.kind);
const writes = (nodes: readonly PlanNode[]) =>
	nodes.map((n) => (n.kind === "loop" ? n.id : n.writes.join(",")));
const loopOf = (plan: RenderPlan, id: string): LoopDecl => {
	const found = planLoops(plan.passes).find((l) => l.id === id);
	if (!found) throw new Error(`no loop "${id}"`);
	return found;
};

/** Where an item of `blur` is at after `n` iterations, in the red of each pixel. */
function blurredRamp(n: number): number[] {
	let row = [0, 1, 2, 3];
	for (let i = 0; i < n; i++) row = row.map((v, x) => (v + (row[Math.min(x + 1, 3)] ?? v)) / 2);
	return row;
}

const red = (model: GraphModel, x: number, node = "view") =>
	evaluate(model, node, "color", "srgb", [4, 4], { images, uv: [(x + 0.5) / 4, 0.5] })[0];

describe("loops in plans", () => {
	it("repeat a blur: a start, a next, and the frame reading what the loop ends as", () => {
		const plan = valid(generateRenderPlan(blurred(3)));
		expect(kinds(plan.passes)).toEqual(["loop", "render"]);
		const [first] = plan.passes;
		if (first?.kind !== "loop") throw new Error("no loop");
		const texture = loopTextureId({ path: [], zone: "p_in" }, "img");
		expect(first).toMatchObject({
			id: "p_in",
			iterations: 3,
			max: 4096,
			items: [{ id: "img", texture, format: "rgba16float" }],
		});
		expect(writes(first.start)).toEqual([loopReadId(texture, "current")]);
		expect(writes(first.next)).toEqual([loopReadId(texture, "next")]);
		expect(first.body).toEqual([]);
		const [start, next] = [first.start[0], first.next[0]];
		expect(start?.kind === "render" && start.reads).toEqual(["media:a"]);
		expect(next?.kind === "render" && next.reads).toEqual([loopReadId(texture, "current")]);
		const target = plan.passes.at(-1);
		expect(target?.kind === "render" && [target.writes, target.reads]).toEqual([
			[PLAN_TARGET],
			[loopReadId(texture, "final")],
		]);
		for (const read of ["current", "next", "final"] as const) {
			expect(plan.resources.find((r) => r.id === loopReadId(texture, read))).toMatchObject({
				kind: "loop",
				texture,
				read,
				loop: "p_in",
			});
		}
	});

	it("give each program of an item the same texture for its current and its final value", () => {
		const plan = generateRenderPlan(blurred(2));
		const texture = loopTextureId({ path: [], zone: "p_in" }, "img");
		const reads = planPasses(plan.passes).flatMap((p) =>
			p.program.textures.flatMap((t) => (t.source.kind === "loop" ? [t.source] : [])),
		);
		expect(reads.map((r) => [r.id, r.read])).toEqual([
			[loopReadId(texture, "current"), "current"],
			[loopReadId(texture, "final"), "final"],
		]);
	});

	it("keep a pass reading the loop in its body, and hoist one that doesn't before it", () => {
		const [bn, be] = blur("p");
		const [vn, ve] = viewed("p_out");
		const graph = new GraphModel({
			...rootProject(
				[
					...loop("p", [IMG], 2),
					{ id: "img", type: "image", data: { asset: "a" } },
					{ id: "uv2", type: "uv" },
					// What the loop's items are copied to, then read by its next.
					{ id: "inside", type: "render-texture", data: { settings: { mode: "scale" } } },
					{ id: "outside", type: "render-texture" },
					{ id: "readInside", type: "sample-texture" },
					{ id: "readOutside", type: "sample-texture" },
					{ id: "both", type: "add" },
					...bn,
					...vn,
				],
				[
					["img", "texture", "p_in", "img"],
					["p_in", "img", "inside", "color"],
					["uv2", "uv", "outside", "color"],
					["inside", "color", "readInside", "texture"],
					["outside", "color", "readOutside", "texture"],
					["readInside", "color", "both", "operands"],
					["readOutside", "color", "both", "operands"],
					...be.filter((e) => e[2] !== "p_out"),
					["both", "result", "p_out", "img"],
					...ve,
				],
			),
			assets: [image],
		});
		const plan = valid(generateRenderPlan(graph));
		expect(writes(plan.passes)).toEqual(["render:outside:color", "p_in", PLAN_TARGET]);
		const decl = loopOf(plan, "p_in");
		expect(writes(decl.body)).toEqual(["render:inside:color"]);
		expect(decl.start).toHaveLength(1);
		expect(decl.next).toHaveLength(1);
	});

	it("can render a value computed in the zone, which a repeat zone's can't", () => {
		const graph = new GraphModel({
			...rootProject(
				[
					...loop("p", [ACC, IMG], 2),
					{ id: "rt", type: "render-texture" },
					{ id: "read", type: "sample-texture" },
					{ id: "img", type: "image", data: { asset: "a" } },
				],
				[
					["p_in", "acc", "rt", "color"],
					["rt", "color", "read", "texture"],
					["img", "texture", "p_in", "img"],
					["p_in", "acc", "p_out", "acc"],
					["read", "color", "p_out", "img"],
					["p_out", "img", "out", "color"],
				],
			),
			assets: [image],
		});
		expect(graph.passAnalysis().sources.output([], "rt", "color").kind).toBe("render");
		const plan = valid(generateRenderPlan(graph));
		expect(writes(loopOf(plan, "p_in").body)).toEqual(["render:rt:color"]);
	});
});

describe("nested loops", () => {
	/** `q` blurs what `p` has, `p` keeping what `q` ends as. */
	function nested(options: { inner: "outer item" | "alone"; iterations?: "outer" }) {
		const [bn, be] = blur("q");
		const [vn, ve] = viewed("p_out");
		return new GraphModel({
			...rootProject(
				[
					...loop("p", [IMG], 2),
					...loop("q", [IMG], 2),
					{ id: "img", type: "image", data: { asset: "a" } },
					...bn,
					...vn,
				],
				[
					["img", "texture", "p_in", "img"],
					options.inner === "alone"
						? ["img", "texture", "q_in", "img"]
						: ["p_in", "img", "q_in", "img"],
					...(options.iterations === "outer"
						? [["p_in", "iteration", "q_in", "iterations"] as TestEdge]
						: []),
					...be.map((e): TestEdge => (e[2] === "q_out" ? e : e)),
					["q_out", "img", "p_out", "img"],
					...ve,
				],
			),
			assets: [image],
		});
	}

	it("hoist an inner loop that doesn't depend on the outer one", () => {
		const plan = valid(generateRenderPlan(nested({ inner: "alone" })));
		expect(writes(plan.passes)).toEqual(["q_in", "p_in", PLAN_TARGET]);
		expect(loopOf(plan, "p_in").body).toEqual([]);
	});

	it("keep an inner loop reading the outer one's items in its body", () => {
		const plan = valid(generateRenderPlan(nested({ inner: "outer item" })));
		expect(writes(plan.passes)).toEqual(["p_in", PLAN_TARGET]);
		const outer = loopOf(plan, "p_in");
		expect(writes(outer.body)).toEqual(["q_in"]);
		const texture = loopTextureId({ path: [], zone: "p_in" }, "img");
		const inner = loopOf(plan, "q_in");
		const start = inner.start[0];
		expect(start?.kind === "render" && start.reads).toEqual([loopReadId(texture, "current")]);
		const next = outer.next[0];
		const innerTexture = loopTextureId({ path: [], zone: "q_in" }, "img");
		expect(next?.kind === "render" && next.reads).toEqual([loopReadId(innerTexture, "final")]);
	});

	it("keep an inner loop counting by the outer iteration in its body", () => {
		const plan = valid(generateRenderPlan(nested({ inner: "alone", iterations: "outer" })));
		const outer = loopOf(plan, "p_in");
		expect(writes(outer.body)).toEqual(["q_in"]);
		const inner = loopOf(plan, "q_in");
		const iterations = inner.iterations;
		expect(typeof iterations).toBe("object");
		if (typeof iterations !== "object") return;
		expect([...frameDependencies(plan.frame, [iterations.frame]).loops]).toEqual(["p_in"]);
		const values = evaluateFrame(plan.frame, {
			time: 0,
			delta: 0,
			frame: 0,
			canvas: { width: 4, height: 4 },
			passSize: { width: 4, height: 4 },
			iteration: (id) => (id === "p_in" ? 1 : undefined),
		});
		expect(values.arg(iterations)).toBe(1);
	});

	it("run an inner loop in every iteration of the outer", () => {
		const model = nested({ inner: "outer item" });
		// Two iterations of two blurs each.
		for (let x = 0; x < 4; x++) expect(red(model, x)).toBeCloseTo(blurredRamp(4)[x] ?? 0, 5);
	});

	it("evaluate an inner count that follows the outer iteration", () => {
		const model = nested({ inner: "outer item", iterations: "outer" });
		// The inner loop blurs 0 times, then once, from what the outer one has.
		for (let x = 0; x < 4; x++) expect(red(model, x)).toBeCloseTo(blurredRamp(1)[x] ?? 0, 5);
	});
});

describe("loop items", () => {
	it("end as the initial value when there are no iterations", () => {
		const model = blurred(0);
		for (let x = 0; x < 4; x++) expect(red(model, x)).toBeCloseTo(x, 5);
	});

	it("are blurred by each iteration, as the evaluator runs them", () => {
		for (const n of [1, 2, 3]) {
			const model = blurred(n);
			for (let x = 0; x < 4; x++)
				expect(red(model, x)).toBeCloseTo(blurredRamp(n)[x] ?? 0, 5);
		}
	});

	/** acc = acc * 2 + iteration, from 1. */
	function accumulating(iterations: number): GraphModel {
		return new GraphModel(
			rootProject(
				[
					...loop("p", [ACC], iterations),
					{ id: "one", type: "declare", data: { values: { x: 1 } } },
					{ id: "two", type: "declare", data: { values: { x: 2 } } },
					{ id: "twice", type: "mul" },
					{ id: "sum", type: "add" },
				],
				[
					["one", "value", "p_in", "acc"],
					["p_in", "acc", "twice", "operands"],
					["two", "value", "twice", "operands"],
					["twice", "result", "sum", "operands"],
					["p_in", "iteration", "sum", "operands"],
					["sum", "result", "p_out", "acc"],
					["p_out", "acc", "out", "color"],
				],
			),
		);
	}

	it("of a value type are read at the pixel, and their next value reads the iteration", () => {
		const expected: Record<number, number> = { 0: 1, 1: 2, 2: 5, 3: 12 };
		for (const [n, value] of Object.entries(expected)) {
			expect(evaluate(accumulating(Number(n)), "p_out", "acc")).toEqual([value]);
		}
		const plan = valid(generateRenderPlan(accumulating(3)));
		const next = loopOf(plan, "p_in").next[0];
		const fields = next?.kind === "render" ? next.program.frameValues.fields : {};
		const field = Object.values(fields)[0];
		const step = field === undefined ? undefined : plan.frame.steps[field.ref.step];
		expect(step).toMatchObject({ kind: "read", input: { source: "iteration:p_in" } });
	});

	it("are kept in textures sized by their own settings, read at the nearest texel", () => {
		const graph = new GraphModel({
			...rootProject(
				[
					...loop("p", [{ ...ACC, size: "pixels" }], 2, {
						values: { iterations: 2, "pixels:acc": { x: 8, y: 1 } },
					}),
					{ id: "one", type: "declare", data: { values: { x: 1 } } },
					{ id: "grow", type: "add" },
				],
				[
					["one", "value", "p_in", "acc"],
					["p_in", "acc", "grow", "operands"],
					["one", "value", "grow", "operands"],
					["grow", "result", "p_out", "acc"],
					["p_out", "acc", "out", "color"],
				],
			),
		});
		const plan = valid(generateRenderPlan(graph));
		const size = { kind: "pixels", width: 8, height: 1 } as const;
		expect(loopOf(plan, "p_in").items[0]?.size).toEqual(size);
		expect(plan.resources.filter((r) => r.kind === "loop").map((r) => r.size)).toEqual([
			size,
			size,
			size,
		]);
		const frame = plan.passes.at(-1);
		expect(frame?.kind === "render" && frame.program.code).toContain("textureDimensions");
		expect(evaluate(graph, "p_out", "acc")).toEqual([3]);
	});
});

describe("item sizes per iteration", () => {
	const SIZE: ZoneItem = { id: "size", label: "Size", type: "vec2f" };

	/**
	 * An inner loop of one iteration whose image item is scaled to
	 * 0.5^(outer iteration + 1) of the canvas; the outer loop keeps the size
	 * it ends with. An item can't read its own loop's iteration (that would
	 * be a cycle), so an inner loop is what's sized by the outer one.
	 */
	function halving(iterations: number): GraphModel {
		return new GraphModel({
			...rootProject(
				[
					...loop("p", [SIZE], iterations),
					...loop("q", [{ ...IMG, size: "scale" }], 1),
					{ id: "img", type: "image", data: { asset: "a" } },
					{ id: "one", type: "declare", data: { values: { x: 1 } } },
					{ id: "half", type: "declare", data: { values: { x: 0.5 } } },
					{ id: "next", type: "add" },
					{ id: "scale", type: "pow" },
					{ id: "measure", type: "texture-size" },
				],
				[
					["img", "texture", "q_in", "img"],
					["p_in", "iteration", "next", "operands"],
					["one", "value", "next", "operands"],
					["half", "value", "scale", "e1"],
					["next", "result", "scale", "e2"],
					["scale", "result", "q_in", "scale:img"],
					["q_in", "img", "q_out", "img"],
					["q_out", "img", "measure", "texture"],
					["measure", "size", "p_out", "size"],
					["p_out", "size", "out", "color"],
				],
			),
			assets: [image],
		});
	}

	const endsAs = (iterations: number) =>
		evaluate(halving(iterations), "p_out", "size", "srgb", [8, 8], { images });

	it("resolve with the iteration of the loop around them", () => {
		const plan = valid(generateRenderPlan(halving(3)));
		expect(writes(loopOf(plan, "p_in").body)).toEqual(["q_in"]);
		const item = loopOf(plan, "q_in").items[0];
		if (item?.size.kind !== "scale" || typeof item.size.scale !== "object") {
			throw new Error("the size doesn't read a frame value");
		}
		const { scale } = item.size;
		expect([...frameDependencies(plan.frame, [scale.frame]).loops]).toEqual(["p_in"]);
		const at = (iteration: number) =>
			evaluateFrame(plan.frame, {
				time: 0,
				delta: 0,
				frame: 0,
				canvas: { width: 8, height: 8 },
				passSize: { width: 8, height: 8 },
				iteration: (id) => (id === "p_in" ? iteration : undefined),
			}).arg(scale);
		expect([at(0), at(1), at(2)]).toEqual([0.5, 0.25, 0.125]);
	});

	it("end a loop of log2(width) halvings at 1x1", () => {
		expect(endsAs(3)).toEqual([1, 1]);
	});

	it("end each loop at the size its last iteration says", () => {
		expect(endsAs(1)).toEqual([4, 4]);
		expect(endsAs(2)).toEqual([2, 2]);
	});

	it("end a loop without iterations as its initial value", () => {
		expect(endsAs(0)).toEqual([0, 0]);
	});
});

describe("frame values of loops", () => {
	it("depend on the iteration only when they read it", () => {
		const graph = new GraphModel({
			...rootProject(
				[
					...loop("p", [IMG], 2),
					{ id: "img", type: "image", data: { asset: "a" } },
					{ id: "t", type: "time" },
					{ id: "twice", type: "add" },
					{ id: "per", type: "render-texture", data: { settings: { mode: "scale" } } },
					{ id: "pixels", type: "render-texture", data: { settings: { mode: "scale" } } },
					{ id: "uv", type: "uv" },
					{ id: "read", type: "sample-texture" },
					{ id: "readPixels", type: "sample-texture" },
					{ id: "both", type: "add" },
				],
				[
					["img", "texture", "p_in", "img"],
					["p_in", "iteration", "twice", "operands"],
					["t", "seconds", "twice", "operands"],
					["twice", "result", "per", "scale"],
					["t", "seconds", "pixels", "scale"],
					["uv", "uv", "per", "color"],
					["uv", "uv", "pixels", "color"],
					["per", "color", "read", "texture"],
					["pixels", "color", "readPixels", "texture"],
					["read", "color", "both", "operands"],
					["readPixels", "color", "both", "operands"],
					["both", "result", "p_out", "img"],
					["p_out", "img", "out", "color"],
				],
			),
			assets: [image],
		});
		const plan = valid(generateRenderPlan(graph));
		// Only the texture sized by the iteration is made again with each.
		expect(writes(plan.passes)).toEqual(["render:pixels:color", "p_in", PLAN_TARGET]);
		expect(writes(loopOf(plan, "p_in").body)).toEqual(["render:per:color"]);
		const sizes = (id: string) => {
			const resource = plan.resources.find((r) => r.id === id);
			return resource?.kind === "transient" && resource.size.kind === "scale"
				? resource.size.scale
				: undefined;
		};
		const per = sizes("render:per:color");
		const fixed = sizes("render:pixels:color");
		expect(typeof per).toBe("object");
		expect(typeof fixed).toBe("object");
		if (typeof per !== "object" || typeof fixed !== "object") return;
		expect([...frameDependencies(plan.frame, [per.frame]).loops]).toEqual(["p_in"]);
		expect([...frameDependencies(plan.frame, [fixed.frame]).loops]).toEqual([]);
		const at = (iteration: number) =>
			evaluateFrame(plan.frame, {
				time: 1,
				delta: 0,
				frame: 0,
				canvas: { width: 4, height: 4 },
				passSize: { width: 4, height: 4 },
				iteration: () => iteration,
			});
		expect([at(0).arg(per), at(3).arg(per)]).toEqual([1, 4]);
		expect([at(0).arg(fixed), at(3).arg(fixed)]).toEqual([1, 1]);
	});
});

/** A group blurring its texture input `t` as many times as its input `n` says. */
function blurry(): GraphProject["definitions"][string] {
	const [bn, be] = blur("p");
	const members: TestNode[] = [
		{ id: "gin", type: "group-input" },
		...loop("p", [IMG], "linked"),
		...bn,
		{ id: "gout", type: "group-output" },
	];
	return {
		label: "Blurry",
		inputs: [
			{ id: "t", label: "Texture", type: "texture" },
			{ id: "n", label: "Count", type: "i32" },
		],
		outputs: [{ id: "c", label: "Result", type: "texture" }],
		nodes: members.map((n): GraphDocumentNode => ({
			id: n.id,
			type: n.type,
			data: n.data ?? {},
			position: at,
		})),
		edges: [
			edge(["gin", "t", "p_in", "img"]),
			edge(["gin", "n", "p_in", "iterations"]),
			...be.map(edge),
			edge(["p_out", "img", "gout", "c"]),
		],
	};
}

describe("loops in groups", () => {
	function twice(): GraphModel {
		const project = rootProject(
			[
				{ id: "img", type: "image", data: { asset: "a" } },
				{
					id: "ga",
					type: "node-group",
					group: { definitionRef: "blurry", locked: false },
					data: { values: { n: 1 } },
				},
				{
					id: "gb",
					type: "node-group",
					group: { definitionRef: "blurry", locked: false },
					data: { values: { n: 2 } },
				},
				{ id: "a", type: "sample-texture" },
				{ id: "b", type: "sample-texture" },
				{ id: "view", type: "add" },
			],
			[
				["img", "texture", "ga", "t"],
				["img", "texture", "gb", "t"],
				["ga", "c", "a", "texture"],
				["gb", "c", "b", "texture"],
				["a", "color", "view", "operands"],
				["b", "color", "view", "operands"],
				["view", "result", "out", "color"],
			],
		);
		project.definitions.blurry = blurry();
		return new GraphModel({ ...project, assets: [image] });
	}

	it("are made for each group node, with passes and textures of their own", () => {
		const plan = valid(generateRenderPlan(twice()));
		const loops = planLoops(plan.passes);
		expect(loops.map((l) => [l.id, l.iterations])).toEqual([
			["ga/p_in", 1],
			["gb/p_in", 2],
		]);
		const ids = planPasses(plan.passes).map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toHaveLength(5);
		expect(new Set(plan.resources.map((r) => r.id)).size).toBe(plan.resources.length);
	});

	it("run as many times as each group node says", () => {
		const model = twice();
		const sum = (x: number) =>
			evaluate(model, "view", "result", "srgb", [4, 4], {
				images,
				uv: [(x + 0.5) / 4, 0.5],
			})[0];
		for (let x = 0; x < 4; x++) {
			expect(sum(x)).toBeCloseTo((blurredRamp(1)[x] ?? 0) + (blurredRamp(2)[x] ?? 0), 5);
		}
	});
});

describe("loops and simulations", () => {
	it("run inside a simulation's step, between its start and its step", () => {
		const [bn, be] = blur("p");
		const plan = valid(
			generateRenderPlan(
				new GraphModel({
					...rootProject(
						[
							{
								id: "s_in",
								type: "simulation-input",
								data: { pairedOutput: "s_out" },
							},
							{ id: "s_out", type: "simulation-output", data: { items: [IMG] } },
							...loop("p", [IMG], 2),
							{ id: "img", type: "image", data: { asset: "a" } },
							...bn,
						],
						[
							["img", "texture", "s_in", "img"],
							["s_in", "img", "p_in", "img"],
							...be,
							["p_out", "img", "s_out", "img"],
							["s_out", "img", "out", "color"],
						],
					),
					assets: [image],
				}),
			),
		);
		const order = writes(plan.passes);
		expect(order).toHaveLength(4);
		expect(order[1]).toBe("p_in");
		expect(plan.passes[0]).toMatchObject({ simulation: { stage: "start" } });
		expect(plan.passes[2]).toMatchObject({ simulation: { stage: "step" } });
		expect(order.at(-1)).toBe(PLAN_TARGET);
		const start = loopOf(plan, "p_in").start[0];
		expect(start?.kind === "render" && start.reads).toEqual(["state:s_in:img:previous"]);
	});

	it("read a simulation's state inside their passes", () => {
		const plan = valid(
			generateRenderPlan(
				new GraphModel(
					rootProject(
						[
							{
								id: "s_in",
								type: "simulation-input",
								data: { pairedOutput: "s_out" },
							},
							{ id: "s_out", type: "simulation-output", data: { items: [ACC] } },
							{ id: "grow", type: "add" },
							{ id: "one", type: "declare", data: { values: { x: 1 } } },
							...loop("p", [ACC], 2),
							{ id: "sum", type: "add" },
						],
						[
							["s_in", "acc", "grow", "operands"],
							["one", "value", "grow", "operands"],
							["grow", "result", "s_out", "acc"],
							["s_out", "acc", "p_in", "acc"],
							["p_in", "acc", "sum", "operands"],
							["s_out", "acc", "sum", "operands"],
							["sum", "result", "p_out", "acc"],
							["p_out", "acc", "out", "color"],
						],
					),
				),
			),
		);
		const order = writes(plan.passes);
		expect(order.indexOf("p_in")).toBeGreaterThan(
			order.findIndex((w) => w.includes(":current") && w.startsWith("state:")),
		);
		expect(order.at(-1)).toBe(PLAN_TARGET);
		expect(loopOf(plan, "p_in").items).toHaveLength(1);
	});
});

describe("looking inside a loop", () => {
	function previewed(): GraphModel {
		const [bn, be] = blur("p");
		const [vn, ve] = viewed("p_out");
		return new GraphModel({
			...rootProject(
				[
					...loop("p", [IMG], 2),
					{ id: "img", type: "image", data: { asset: "a" } },
					...bn,
					...vn,
				],
				[
					["img", "texture", "p_in", "img"],
					...be,
					...ve,
					// A preview of a node in the zone: a link that leaves it.
					["p_half", "result", "out", "color"],
				].map((e) =>
					e[0] === "p_half" ? ["p_half", "result", "out", "color"] : e,
				) as TestEdge[],
			),
			assets: [image],
		});
	}

	it("makes a link out of the zone invalid, drawn as it was", () => {
		const graph = previewed();
		const analysis = graph.zoneAnalysis(graph.root);
		expect(analysis.invalidEdges.size).toBeGreaterThan(0);
		expect(() => generateRenderPlan(graph)).not.toThrow();
		valid(generateRenderPlan(graph));
	});

	it("draws a value of the zone to a texture in the loop's body", () => {
		const [bn, be] = blur("p");
		const graph = new GraphModel({
			...rootProject(
				[
					...loop("p", [IMG], 2),
					{ id: "img", type: "image", data: { asset: "a" } },
					...bn,
					{ id: "read", type: "sample-texture" },
				],
				[
					["img", "texture", "p_in", "img"],
					...be.filter((e) => e[2] !== "p_out"),
					["p_half", "result", "read", "texture"],
					["read", "color", "p_out", "img"],
					["p_out", "img", "out", "color"],
				],
			),
			assets: [image],
		});
		const plan = valid(generateRenderPlan(graph));
		expect(writes(loopOf(plan, "p_in").body)).toEqual(["render:p_half:result"]);
	});

	it("generates a shader for any socket in it", () => {
		const graph = blurred(2);
		const generated = generateShader(graph, {
			target: { path: [], node: "p_half", handle: "result" },
		});
		expect(generated.textures.map((t) => t.source.kind)).toEqual(["loop"]);
		if (nagaBin) {
			const { fragment, uniforms, textures, samplers } = fragmentOf(generated);
			expect(validateFragment(fragment, uniforms, { textures, samplers })).toBeNull();
		}
	});

	it("keeps a Render Texture's mips in the body", () => {
		const graph = new GraphModel({
			...rootProject(
				[
					...loop("p", [IMG], 2),
					{ id: "img", type: "image", data: { asset: "a" } },
					{ id: "rt", type: "render-texture", data: { settings: { mips: "on" } } },
					{ id: "read", type: "sample-texture", data: { values: { level: 1 } } },
				],
				[
					["img", "texture", "p_in", "img"],
					["p_in", "img", "rt", "color"],
					["rt", "color", "read", "texture"],
					["read", "color", "p_out", "img"],
					["p_out", "img", "out", "color"],
				],
			),
			assets: [image],
		});
		const plan = valid(generateRenderPlan(graph));
		expect(writes(loopOf(plan, "p_in").body)).toEqual(["render:rt:color"]);
		const resource = plan.resources.find((r) => r.id === "render:rt:color");
		expect(resource?.kind === "transient" && resource.mips).toBe(true);
	});
});
