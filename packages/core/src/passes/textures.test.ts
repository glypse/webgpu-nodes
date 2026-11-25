import { describe, expect, it } from "bun:test";

import type { Asset } from "../assets/assets";
import { buildProgram, generateShader } from "../codegen";
import type { GraphProject } from "../graph/document";
import { GraphModel } from "../graph/model";
import { edge, rootProject, type TestEdge, type TestNode } from "../testing/graph";
import { fragmentOf, nagaBin, validateFragment } from "../testing/wgsl";
import { EMPTY_TEXTURE, mediaTextureId, type TextureResolution, TextureSources } from "./sources";
import { CANVAS_SIZE, type TextureFormat, type TextureSize } from "./textures";

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

	it("link to textures and float colours, values to textures, never to zone items", () => {
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
		expect(link("s", "texture", "two", "value")).toBe(true);
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

/** Sources whose Image nodes are renders of the given size and format, as Render Texture will make. */
class Rendered extends TextureSources {
	constructor(
		graph: GraphModel,
		private size: TextureSize,
		private format: TextureFormat,
	) {
		super(graph);
	}

	override output(path: readonly string[], node: string, handle: string): TextureResolution {
		return {
			kind: "render",
			id: `render:${node}`,
			target: { path, node, handle },
			size: this.size,
			format: this.format,
		};
	}
}

describe("textures of any size and format", () => {
	const half: TextureSize = { kind: "scale", scale: 0.5, of: "canvas" };

	function read(size: TextureSize, format: TextureFormat, sample: boolean) {
		const nodes: TestNode[] = [{ id: "img", type: "image", data: { asset: "a" } }];
		const edges: TestEdge[] = [
			["img", "texture", sample ? "s" : "out", sample ? "texture" : "color"],
		];
		if (sample) {
			nodes.push({ id: "s", type: "sample-texture" });
			edges.push(["s", "color", "out", "color"]);
		}
		const graph = new GraphModel(project(nodes, edges));
		const generated = generateShader(graph, { sources: new Rendered(graph, size, format) });
		expectValid(generated);
		const program = buildProgram(generated.shader, generated.uniforms, generated);
		return { generated, program };
	}

	it("are read exactly at the pixel when made for the pass' size", () => {
		const { generated } = read(CANVAS_SIZE, "rgba16float", false);
		expect(generated.shader).toContain(
			"textureLoad(runtime_texture_0, vec2i(runtime_fragment.position), 0)",
		);
		expect(read(CANVAS_SIZE, "r32uint", false).generated.shader).toContain(
			"vec4f(textureLoad(runtime_texture_0, vec2i(runtime_fragment.position), 0))",
		);
	});

	it("are sampled when made for another size", () => {
		const { generated } = read(half, "rgba16float", false);
		expect(generated.shader).toContain("textureSampleLevel(runtime_texture_0");
		expect(generated.shader).not.toContain("textureLoad");
	});

	it("are read exactly where the pass' size is the texture's, whatever the canvas", () => {
		const graph = new GraphModel(
			project(
				[{ id: "img", type: "image", data: { asset: "a" } }],
				[["img", "texture", "out", "color"]],
			),
		);
		const generated = generateShader(graph, {
			sources: new Rendered(graph, half, "rgba16float"),
			targetSize: half,
		});
		expect(generated.shader).toContain("textureLoad(runtime_texture_0, vec2i(");
	});

	it("are filtered by hand when 32-bit floats", () => {
		const { generated, program } = read(CANVAS_SIZE, "rgba32float", true);
		expect(generated.samplers).toEqual([]);
		expect(generated.shader).toContain("fn texture_bilinear(");
		expect(generated.shader).toContain("texture_bilinear(runtime_texture_0,");
		expect(program.textures.map((t) => t.sampleType)).toEqual(["unfilterable-float"]);
	});

	describe("read at a level", () => {
		function atLevel(format: TextureFormat, data: TestNode["data"], leveled = true) {
			const nodes: TestNode[] = [
				{ id: "img", type: "image", data: { asset: "a" } },
				{ id: "s", type: "sample-texture", ...(data ? { data } : {}) },
				{ id: "t", type: "time" },
			];
			const edges: TestEdge[] = [
				["img", "texture", "s", "texture"],
				["s", "color", "out", "color"],
				...(leveled ? [["t", "seconds", "s", "level"] as TestEdge] : []),
			];
			const graph = new GraphModel(project(nodes, edges));
			const generated = generateShader(graph, {
				sources: new Rendered(graph, CANVAS_SIZE, format),
			});
			expectValid(generated);
			return generated.shader;
		}

		it("blend the two nearest levels of a 32-bit float texture filtered linearly", () => {
			const shader = atLevel("rgba32float", { settings: { interpolation: "linear" } });
			expect(shader).toContain("fn texture_trilinear(");
			expect(shader).toContain("fn texture_bilinear(");
			expect(shader).toContain("texture_trilinear(runtime_texture_0,");
			expect(shader).not.toContain("round(");
		});

		it("read the base level once, by a single bilinear read", () => {
			const shader = atLevel("rgba32float", {}, false);
			expect(shader).not.toContain("texture_trilinear");
			expect(shader).toContain("texture_bilinear(runtime_texture_0,");
		});

		it("round to a level when the filter is nearest", () => {
			const shader = atLevel("rgba32float", { values: { interpolation: 1 } });
			expect(shader).not.toContain("texture_trilinear");
			expect(shader).toContain("round(");
		});
	});

	it("are read at the nearest texel when integers", () => {
		const { generated, program } = read(half, "r32uint", false);
		expect(generated.shader).toContain("vec4f(textureLoad(runtime_texture_0, vec2i(clamp(");
		expect(program.textures.map((t) => t.sampleType)).toEqual(["uint"]);
		expect(program.code).toContain("texture_2d<u32>");
		const sampled = read(half, "rgba32sint", true);
		expect(sampled.generated.samplers).toEqual([]);
		expect(sampled.program.code).toContain("texture_2d<i32>");
	});
});
