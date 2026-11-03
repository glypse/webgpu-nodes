import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { generateShader } from "../codegen";
import type { GraphProject } from "../graph/document";
import { GraphModel } from "../graph/model";
import { edge, rootProject, type TestEdge, type TestNode } from "../testing/graph";
import { fragmentOf, nagaBin, validateFragment } from "../testing/wgsl";
import { EMPTY_TEXTURE, mediaTextureId } from "./sources";

const at = { x: 0, y: 0 };

const image = (id: string): Asset => ({
	kind: "image",
	id,
	name: id,
	file: `assets/images/${id}.png`,
	mime: "image/png",
	bytes: 1,
	hash: id,
	width: 4,
	height: 2,
});

function project(nodes: TestNode[], edges: TestEdge[]): GraphProject {
	return { ...rootProject(nodes, edges), assets: [image("a"), image("b")] };
}

function expectValid(generated: ReturnType<typeof generateShader>) {
	if (!nagaBin) return;
	const { fragment, uniforms, ...resources } = fragmentOf(generated);
	expect(validateFragment(fragment, uniforms, resources)).toBeNull();
}

/** A group sampling its Texture input `t` at the pixel, into its output `c`. */
function sampler(): GraphProject["definitions"][string] {
	return {
		label: "Sampler",
		inputs: [{ id: "t", label: "Texture", type: "texture" }],
		outputs: [{ id: "c", label: "Color", type: "vec4f" }],
		nodes: [
			{ id: "gin", type: "group-input", data: {}, position: at },
			{ id: "s", type: "sample-texture", data: {}, position: at },
			{ id: "gout", type: "group-output", data: {}, position: at },
		],
		edges: [edge(["gin", "t", "s", "texture"]), edge(["s", "color", "gout", "c"])],
	};
}

describe("textures", () => {
	it("are sampled at the pixel when linked to a value", () => {
		const graph = new GraphModel(
			project(
				[{ id: "img", type: "image", data: { asset: "a" } }],
				[["img", "texture", "out", "color"]],
			),
		);
		expect(graph.resolveInputType("out", "color")).toBe("vec4f");
		const generated = generateShader(graph);
		expect(generated.textures.map((t) => t.source.id)).toEqual([mediaTextureId("a")]);
		expect(generated.shader).toContain("textureSampleLevel(runtime_texture_0");
		expectValid(generated);
	});

	it("read nothing when unlinked, or when their asset is gone", () => {
		const graph = new GraphModel(
			project(
				[
					{ id: "img", type: "image", data: { asset: "gone" } },
					{ id: "s", type: "sample-texture" },
				],
				[
					["img", "texture", "s", "texture"],
					["s", "color", "out", "color"],
				],
			),
		);
		const generated = generateShader(graph);
		expect(generated.textures.map((t) => t.source.id)).toEqual([EMPTY_TEXTURE]);
		expectValid(generated);
	});

	it("sample with the addressing a known extension asks for", () => {
		const graph = new GraphModel(
			project(
				[
					{ id: "img", type: "image", data: { asset: "a" } },
					{
						id: "s",
						type: "sample-texture",
						data: { values: { extension: 2, interpolation: 1 } },
					},
				],
				[
					["img", "texture", "s", "texture"],
					["s", "color", "out", "color"],
				],
			),
		);
		const generated = generateShader(graph);
		expect(generated.samplers).toEqual([
			{
				name: "runtime_sampler_nearest_mirror",
				filter: "nearest",
				address: "mirror",
			},
		]);
		expectValid(generated);
	});

	it("give a group used twice one function per texture it reads", () => {
		const root = project(
			[
				{ id: "a", type: "image", data: { asset: "a" } },
				{ id: "b", type: "image", data: { asset: "b" } },
				{
					id: "ga",
					type: "node-group",
					group: { definitionRef: "sampler", locked: false },
				},
				{
					id: "gb",
					type: "node-group",
					group: { definitionRef: "sampler", locked: false },
				},
				{ id: "sum", type: "add" },
			],
			[
				["a", "texture", "ga", "t"],
				["b", "texture", "gb", "t"],
				["ga", "c", "sum", "operands"],
				["gb", "c", "sum", "operands"],
				["sum", "result", "out", "color"],
			],
		);
		root.definitions.sampler = sampler();
		const generated = generateShader(new GraphModel(root));
		expect(generated.textures.map((t) => t.source.id)).toEqual([
			mediaTextureId("a"),
			mediaTextureId("b"),
		]);
		expect(generated.shader).toContain("group_h_sampler__x0(");
		expect(generated.shader).toContain("group_h_sampler__x1(");
		expectValid(generated);
	});

	it("pass through reroutes and switches whose case is known", () => {
		const graph = new GraphModel(
			project(
				[
					{ id: "a", type: "image", data: { asset: "a" } },
					{ id: "b", type: "image", data: { asset: "b" } },
					{ id: "r", type: "reroute" },
					{ id: "pick", type: "index-switch", data: { values: { index: 1 } } },
				],
				[
					["a", "texture", "r", "in"],
					["r", "out", "pick", "case-0"],
					["b", "texture", "pick", "case-1"],
					["pick", "result", "out", "color"],
				],
			),
		);
		expect(graph.resolveOutputHandleType("r", "out")).toBe("texture");
		expect(graph.resolveOutputHandleType("pick", "result")).toBe("texture");
		const generated = generateShader(graph);
		expect(generated.textures.map((t) => t.source.id)).toEqual([mediaTextureId("b")]);
		expectValid(generated);
	});

	it("link to textures and float colours only, never to zone items", () => {
		const graph = new GraphModel(
			project(
				[
					{ id: "img", type: "image", data: { asset: "a" } },
					{ id: "s", type: "sample-texture" },
					{ id: "len", type: "length" },
					{ id: "abs", type: "abs" },
					{ id: "two", type: "declare", data: { types: { declare: "vec2f" } } },
				],
				[],
			),
		);
		const link = (
			target: string,
			targetHandle: string,
			source = "img",
			sourceHandle = "texture",
		) => graph.isValidConnection({ source, sourceHandle, target, targetHandle });
		expect(link("s", "texture")).toBe(true);
		expect(link("abs", "e")).toBe(true);
		expect(link("s", "uv")).toBe(false);
		expect(link("s", "texture", "two", "value")).toBe(false);
		const zone = graph.createRepeatZone(at) ?? "";
		const items = graph.getZoneItems(zone);
		expect(link(zone, "__new_item__")).toBe(false);
		graph.connect({
			source: "img",
			sourceHandle: "texture",
			target: zone,
			targetHandle: "__new_item__",
		});
		expect(graph.getZoneItems(zone)).toEqual(items);
	});
});
