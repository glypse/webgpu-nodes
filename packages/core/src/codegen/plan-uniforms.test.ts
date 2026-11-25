import { describe, expect, it } from "bun:test";

import { caseHandle, CASES_FAMILY } from "../enums";
import { ROOT_ID } from "../graph/document";
import { GraphModel } from "../graph/model";
import demo from "../scenes/default.json";
import { managerFor, type TestEdge, type TestNode } from "../testing/graph";
import { TEXTURE } from "../types";
import { editableScopes, reachableShaderHash } from "./generate";
import { uniformInputKey } from "./literals";
import {
	generateRenderPlan,
	planPasses,
	planUniformInputs,
	planUniforms,
	type RenderPlan,
} from "./plan";
import { planKey } from "./plan-key";

const options = { uniformScopes: [ROOT_ID] };

/**
 * A vec4 sum of two declares (one with no stored value, so it reads its
 * default) drawn by a Render Texture whose scale is a product of a sine and
 * an i32 converted to f32: the scale is a frame value, so its inputs are
 * read by the frame program rather than a pass.
 */
function scene(): GraphModel {
	const nodes: TestNode[] = [
		{
			id: "c",
			type: "declare",
			data: { types: { declare: "vec4f" }, values: { x: 0.1, y: 0.2, z: 0.3, w: 1 } },
		},
		{ id: "dv", type: "declare", data: { types: { declare: "vec4f" } } },
		{ id: "sum", type: "add" },
		{ id: "k", type: "declare", data: { types: { declare: "i32" }, values: { x: 3 } } },
		{ id: "tf", type: "to-float" },
		{ id: "sn", type: "sin", data: { values: { e: 2 } } },
		{ id: "sc", type: "mul" },
		{ id: "rt", type: "render-texture" },
		{ id: "s", type: "sample-texture" },
	];
	const edges: TestEdge[] = [
		["c", "value", "sum", "operands"],
		["dv", "value", "sum", "operands"],
		["sum", "result", "rt", "color"],
		["k", "value", "tf", "e"],
		["tf", "result", "sc", "operands"],
		["sn", "result", "sc", "operands"],
		["sc", "result", "rt", "scale"],
		["rt", "color", "s", "texture"],
		["s", "color", "out", "color"],
	];
	return managerFor(nodes, edges);
}

/** A texture switch: its index picks which of two Render Textures is sampled. */
function textureSwitch(): GraphModel {
	const nodes: TestNode[] = [
		{
			id: "c",
			type: "declare",
			data: { types: { declare: "vec4f" }, values: { x: 0.1, y: 0.2, z: 0.3, w: 1 } },
		},
		{ id: "a", type: "render-texture" },
		{ id: "b", type: "render-texture" },
		{ id: "ix", type: "index-switch", data: { cases: 2, types: { [CASES_FAMILY]: TEXTURE } } },
		{ id: "s", type: "sample-texture" },
	];
	const edges: TestEdge[] = [
		["c", "value", "a", "color"],
		["c", "value", "b", "color"],
		["a", "color", "ix", caseHandle(0)],
		["b", "color", "ix", caseHandle(1)],
		["ix", "result", "s", "texture"],
		["s", "color", "out", "color"],
	];
	return managerFor(nodes, edges);
}

/** A plan updated by planUniforms must agree with a fresh one: same uniforms, and same compiled programs. */
function expectCurrent(model: GraphModel, plan: RenderPlan) {
	const fresh = generateRenderPlan(model, options);
	expect(planUniforms(plan, model)).toEqual(fresh.uniforms);
	expect(planKey(plan)).toBe(planKey(fresh));
	expect(planPasses(plan.passes).map((p) => p.program.code)).toEqual(
		planPasses(fresh.passes).map((p) => p.program.code),
	);
}

describe("planUniforms", () => {
	it("gives the values a fresh plan does after uniform edits", () => {
		const model = scene();
		const plan = generateRenderPlan(model, options);
		expect(planUniformInputs(plan)).toEqual(
			new Set([
				...["x", "y", "z", "w"].map((c) => uniformInputKey("c", c)),
				...["x", "y", "z", "w"].map((c) => uniformInputKey("dv", c)),
				uniformInputKey("k", "x"),
				uniformInputKey("sn", "e"),
				uniformInputKey("s", "level"),
			]),
		);
		model.setInputValue("c", "x", 0.5);
		expectCurrent(model, plan);
		model.setInputValue("dv", "y", 0.7);
		expectCurrent(model, plan);
		model.setInputValue("k", "x", 5);
		expectCurrent(model, plan);
		model.setInputValue("sn", "e", 1.5);
		expectCurrent(model, plan);
	});
});

describe("reachableShaderHash", () => {
	it("doesn't change with layout frames", () => {
		const model = scene();
		const hashOf = () =>
			reachableShaderHash(
				model.project,
				model.assets,
				planUniformInputs(generateRenderPlan(model, options)),
			);
		const before = hashOf();
		const frame = model.frameNodes(["sum"]);
		expect(frame).toBeDefined();
		expect(hashOf()).toBe(before);
		model.removeFromFrame(["sum"]);
		expect(hashOf()).toBe(before);
	});

	it("doesn't change with the uniform inputs' values", () => {
		const model = scene();
		const plan = generateRenderPlan(model, options);
		const ignored = planUniformInputs(plan);
		const before = reachableShaderHash(model.project, model.assets, ignored);
		model.setInputValue("c", "x", 0.5);
		model.setInputValue("dv", "y", 0.7);
		model.setInputValue("k", "x", 5);
		model.setInputValue("sn", "e", 1.5);
		expect(reachableShaderHash(model.project, model.assets, ignored)).toBe(before);
	});

	it("changes with edits that aren't uniform inputs", () => {
		const ignoredFor = (model: GraphModel) =>
			planUniformInputs(generateRenderPlan(model, options));
		const hashOf = (model: GraphModel) =>
			reachableShaderHash(model.project, model.assets, ignoredFor(model));

		const edits: [string, (model: GraphModel) => void][] = [
			[
				"a compiled value",
				(m) => {
					m.setInputValue("s", "interpolation", 1);
				},
			],
			[
				"a setting",
				(m) => {
					m.updateNodeData("rt", { settings: { mode: "scale", mips: "on" } });
				},
			],
			[
				"a link",
				(m) => {
					m.connect({
						source: "c",
						sourceHandle: "value",
						target: "rt",
						targetHandle: "color",
					});
				},
			],
		];
		for (const [name, edit] of edits) {
			const model = scene();
			const before = hashOf(model);
			edit(model);
			expect(hashOf(model), name).not.toBe(before);
		}
	});

	it("changes with an Index Switch index over textures", () => {
		const model = textureSwitch();
		const hashOf = () =>
			reachableShaderHash(
				model.project,
				model.assets,
				planUniformInputs(generateRenderPlan(model, options)),
			);
		const before = hashOf();
		model.setInputValue("ix", "index", 1);
		expect(hashOf()).not.toBe(before);
	});
});

describe("editable scopes", () => {
	it("keep the shader the same while values inside groups are edited", async () => {
		const model = new GraphModel();
		const loaded = await model.loadProject(demo);
		expect(loaded.ok).toBe(true);
		const scopes = editableScopes(model.project);
		const hashOf = (inputs: ReadonlySet<string>) =>
			reachableShaderHash(model.project, model.assets, inputs);
		const plan = generateRenderPlan(model, { uniformScopes: scopes });
		const inputs = planUniformInputs(plan);
		const inside = [...plan.uniformInputs.entries()].find(
			([, { node }]) => !model.root.nodesById.has(node),
		);
		expect(inside).toBeDefined();
		if (!inside) return;
		const [name, { node, input }] = inside;
		const before = hashOf(inputs);
		model.setInputValue(node, input, 0.123);
		expect(hashOf(inputs)).toBe(before);
		expect(planUniforms(plan, model)[name]).toBeDefined();
		const again = generateRenderPlan(model, { uniformScopes: scopes });
		expect(planUniformInputs(again)).toEqual(inputs);
	});
});
