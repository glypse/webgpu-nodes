import { clipToGamut } from "../color/display";
import { FrameValueAnalysis } from "../frame/analysis";
import { evaluateFrame, FrameCompiler } from "../frame/program";
import type { GraphDocumentEdge, GraphNode, HydratedGraphDocument } from "../graph/document";
import type { GraphModel } from "../graph/model";
import type { ColorSpace } from "../graph/settings";
import { componentKeys, readComponent } from "../graph/values";
import { coerce } from "../nodes/cpu";
import {
	LOAD_TEXEL,
	SAMPLE_TEXTURE,
	SAMPLE_TEXTURE_LEVEL,
	TEXTURE_SIZE,
	TEXTURE_SIZE_LEVEL,
} from "../nodes/texture";
import { loopId, type LoopRef } from "../passes/loop";
import { texelType } from "../passes/simulation";
import { readSource, type TextureSource, TextureSources } from "../passes/sources";
import {
	channelsOf,
	mipLevelCount,
	mipWeights,
	resolveSize,
	scalarOf,
	type Size,
	type TextureFormat,
	type TextureSize,
} from "../passes/textures";
import {
	type CpuCtx,
	isTexture,
	type ResolvedNodeTypes,
	type TypeBindings,
	typeComponents,
	type Value,
	valueType,
	type WgslType,
} from "../types";
import {
	ITERATION_HANDLE,
	ITERATIONS_HANDLE,
	PASS_REPEAT_INPUT,
	PASS_REPEAT_OUTPUT,
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	zoneItems,
	zoneMaxIterations,
} from "../zones";

/** An image as the evaluator reads it: straight-alpha linear RGBA texels, rows top first. */
export type CpuTexture = {
	width: number;
	height: number;
	/** How many mip levels it has; one without. */
	levels?: number;
	texel(x: number, y: number): Value;
};

/** What evaluations of one model share: the textures drawn so far, kept for the next pixel. */
export type EvaluationContext = { readonly env: Env };

/**
 * A context to pass to several `evaluate` calls of one model, canvas and
 * images, so each texture is drawn once however many pixels read it.
 */
export function evaluationContext(
	model: GraphModel,
	images: ReadonlyMap<string, CpuTexture> = new Map(),
): EvaluationContext {
	const sources = new TextureSources(model);
	const frame = new FrameCompiler(model, new FrameValueAnalysis(model, sources), sources);
	return {
		env: {
			sources,
			images,
			renders: new Map(),
			frame,
			sizing: new Set(),
			sizes: new Map(),
			loops: new Map(),
			finals: new Map(),
		},
	};
}

export type EvaluateOptions = {
	/** Textures drawn by earlier evaluations, if given: the model, canvas and images must be the same. */
	context?: EvaluationContext;
	/** The pixel's coordinates (origin bottom-left, as the UV node gives them). */
	uv?: readonly [number, number];
	/** The images of the project's assets, by asset id. */
	images?: ReadonlyMap<string, CpuTexture>;
};

/** Where a Repeat Passes loop being run is: its iteration, and its items as they are then. */
type LoopScope = { iteration: number; items: ReadonlyMap<string, CpuTexture> };

/** What every frame of one evaluation shares. */
type Env = {
	sources: TextureSources;
	images: ReadonlyMap<string, CpuTexture>;
	/** Values rendered to textures so far, by texture id. */
	renders: Map<string, CpuTexture>;
	/** The frame values the sizes of textures read. */
	frame: FrameCompiler;
	/** The textures whose size is being worked out: it can't depend on itself. */
	sizing: Set<string>;
	/** The size of every texture resolved so far, by texture id, and its mip levels. */
	sizes: Map<string, Size & { levels?: number }>;
	/**
	 * The loops being run around what's evaluated, by id. A texture keeps the
	 * ones it was made in, as it's computed texel by texel when read.
	 */
	loops: ReadonlyMap<string, LoopScope>;
	/** The items the loops ended as, by loop and where it was run (see `scopeKey`). */
	finals: Map<string, ReadonlyMap<string, CpuTexture>>;
};

/** Which run of its loops what's evaluated is in: textures made in other runs are other textures. */
function scopeKey(env: Env): string {
	return [...env.loops].map(([id, loop]) => `${id}=${String(loop.iteration)}`).join(",");
}

/** Runs `compute` as in `loops`, as a texture computing its texels late does. */
function inLoops<T>(env: Env, loops: ReadonlyMap<string, LoopScope>, compute: () => T): T {
	const outer = env.loops;
	env.loops = loops;
	try {
		return compute();
	} finally {
		env.loops = outer;
	}
}

type Frame = {
	env: Env;
	doc: HydratedGraphDocument;
	/** The group nodes the document is computed through, from the root. */
	path: readonly string[];
	uv: readonly [number, number];
	/** The gamut of the target drawn to. */
	colorSpace: ColorSpace;
	/** The size of the canvas drawn to, in pixels. */
	resolution: readonly [number, number];
	/** The types the document's variables take (see `TypeBindings`). */
	bindings: TypeBindings;
	groupInputs: ReadonlyMap<string, Value>;
	/** The current state of the repeat zones being run, by Repeat Input id. */
	zones: ReadonlyMap<string, { iteration: number; state: ReadonlyMap<string, Value> }>;
	/** The final state of the zones run in this frame, by Repeat Output id. */
	finals: Map<string, ReadonlyMap<string, Value>>;
	/** Outputs computed in this frame, by node and handle id. */
	computed: Map<string, Value>;
};

/**
 * Compute an output of a node of the root document on the CPU, for the
 * node types the standard library's maths uses, as drawn to `colorSpace`
 * on a canvas of `resolution`.
 * Throws on any other node type.
 */
export function evaluate(
	model: GraphModel,
	nodeId: string,
	handleId: string,
	colorSpace: ColorSpace = "srgb",
	resolution: readonly [number, number] = [1, 1],
	{ uv = [0.5, 0.5], images = new Map(), context }: EvaluateOptions = {},
): Value {
	const { env } = context ?? evaluationContext(model, images);
	return output(model, rootFrame(model, env, uv, colorSpace, resolution), nodeId, handleId);
}

function rootFrame(
	model: GraphModel,
	env: Env,
	uv: readonly [number, number],
	colorSpace: ColorSpace,
	resolution: readonly [number, number],
): Frame {
	return {
		env,
		doc: model.root,
		path: [],
		uv,
		colorSpace,
		resolution,
		groupInputs: new Map(),
		zones: new Map(),
		finals: new Map(),
		computed: new Map(),
		bindings: NO_BINDINGS,
	};
}

/** The frame computing the group node `nodeId` of `frame`'s document, its inputs from there. */
function groupFrame(model: GraphModel, frame: Frame, node: GraphNode): Frame {
	const doc = node.group && model.project.definitions.get(node.group.definitionRef);
	if (!doc) throw new Error(`no definition for "${node.id}"`);
	const descriptor = descriptorOf(model, node);
	const resolved = typesIn(model, frame, node);
	const groupInputs = new Map(
		descriptor.inputs
			.filter((i) => !isTexture(resolved.inputTypes[i.id]))
			.map((i) => [i.id, input(model, frame, node, i.id)]),
	);
	return {
		...frame,
		doc,
		path: [...frame.path, node.id],
		groupInputs,
		zones: new Map(),
		finals: new Map(),
		computed: new Map(),
		bindings: resolved.bindings ?? NO_BINDINGS,
	};
}

const EMPTY_IMAGE: CpuTexture = { width: 1, height: 1, texel: () => [0, 0, 0, 0] };

/** The size `size` is at the first moment, `like` being the texture it may be relative to. */
function sizeOf(
	model: GraphModel,
	frame: Frame,
	size: TextureSize,
	like?: TextureSource,
): { width: number; height: number } {
	const { env } = frame;
	const canvas = { width: frame.resolution[0], height: frame.resolution[1] };
	// What the size is made of is resolved before it's read.
	const resolve = (texture: TextureSource) => {
		if (texture.kind !== "empty" && !env.sizing.has(texture.id)) {
			textureOf(model, frame, texture);
		}
	};
	if (like) resolve(like);
	for (const texture of env.frame.sizedTextures()) resolve(texture);
	const values = evaluateFrame(env.frame.program(), {
		time: 0,
		delta: 0,
		frame: 0,
		canvas,
		passSize: canvas,
		iteration: (id) => env.loops.get(id)?.iteration,
		textureSize: (id) => env.sizes.get(id),
	});
	return resolveSize(size, {
		canvas,
		resource: (id) => env.sizes.get(id),
		frame: (ref) => values.arg({ frame: ref }),
	});
}

/** The frame computing the document at `path`, for the pixel at `uv` of a texture of `resolution`. */
function frameAt(
	model: GraphModel,
	frame: Frame,
	path: readonly string[],
	uv: readonly [number, number],
	resolution: readonly [number, number],
): Frame {
	let at = rootFrame(model, frame.env, uv, frame.colorSpace, resolution);
	for (const id of path) {
		const node = at.doc.nodesById.get(id);
		if (!node) throw new Error(`no group node "${id}"`);
		at = groupFrame(model, at, node);
	}
	return at;
}

/** The image a texture source reads, rendering a value over the canvas when it's a render. */
function textureOf(model: GraphModel, frame: Frame, source: TextureSource): CpuTexture {
	const { env } = frame;
	if (source.kind === "media") {
		const image = env.images.get(source.asset) ?? EMPTY_IMAGE;
		env.sizes.set(source.id, {
			width: image.width,
			height: image.height,
			levels: levelsOf(image),
		});
		return image;
	}
	// Simulations aren't run here: their state reads nothing.
	if (source.kind === "empty" || source.kind === "state") return EMPTY_IMAGE;
	if (source.kind === "loop") return loopTexture(model, frame, source);
	const key = `${source.id}@${scopeKey(env)}`;
	const done = env.renders.get(key);
	if (done) {
		env.sizes.set(source.id, {
			width: done.width,
			height: done.height,
			levels: levelsOf(done),
		});
		return done;
	}
	env.sizing.add(source.id);
	const { width, height } = (() => {
		try {
			return sizeOf(model, frame, source.size, source.draw?.like);
		} finally {
			env.sizing.delete(source.id);
		}
	})();
	const levels = source.mips ? mipLevelCount({ width, height }) : 1;
	env.sizes.set(source.id, { width, height, levels });
	const loops = env.loops;
	const texels = new Map<number, Value>();
	const { target, draw } = source;
	const texture: CpuTexture = {
		width,
		height,
		levels,
		texel: (x, y) => {
			const key = y * width + x;
			const known = texels.get(key);
			if (known) return known;
			const uv = [(x + 0.5) / width, 1 - (y + 0.5) / height] as const;
			// The pass' size is what its Resolution node gives.
			const resolution = draw ? ([width, height] as const) : frame.resolution;
			const value = inLoops(env, loops, () => {
				const at = frameAt(model, frame, target.path, uv, resolution);
				const node = at.doc.nodesById.get(target.node);
				if (!node) throw new Error(`no node "${target.node}"`);
				if (draw) {
					const item = draw.run.find((i) => i.item === target.handle);
					return packTexel(
						input(model, at, node, target.handle),
						item?.type ?? "vec4f",
						source.format,
					);
				}
				const type = valueType(
					typesIn(model, at, node).resolvedOutputs.find((o) => o.id === target.handle)
						?.type ?? "f32",
				);
				return fieldColor(output(model, at, target.node, target.handle), type);
			});
			texels.set(key, value);
			return value;
		},
	};
	env.renders.set(key, texture);
	return texture;
}

/** The texture of a loop's item: as it is in the iteration being run, or as the loop ends. */
function loopTexture(
	model: GraphModel,
	frame: Frame,
	source: TextureSource & { kind: "loop" },
): CpuTexture {
	const { env } = frame;
	const texture =
		source.read === "final"
			? runLoop(model, frame, source.loop).get(source.texture)
			: env.loops.get(loopId(source.loop))?.items.get(source.texture);
	if (!texture) {
		// A size reading an item's current value has none to read when the item is
		// first made: the canvas stands in.
		const [width, height] = frame.resolution;
		env.sizes.set(source.id, { width, height, levels: 1 });
		return EMPTY_IMAGE;
	}
	env.sizes.set(source.id, { width: texture.width, height: texture.height, levels: 1 });
	return texture;
}

/** A texel of an item as `format` keeps it. */
function storeTexel(value: Value, type: WgslType, format: TextureFormat): Value {
	const texel = coerce(coerce(value, type), texelType(format));
	const channels = channelsOf(format);
	return texel.map((c, i) => {
		if (i >= channels) return i === 3 ? 1 : 0;
		return format === "rgba8unorm" ? Math.round(Math.min(Math.max(c, 0), 1) * 255) / 255 : c;
	});
}

/** A texel of a texture as the pixel `frame` computes, the nearest of its texels. */
function texelAtPixel(texture: CpuTexture, frame: Frame): Value {
	return texelAt(
		texture,
		Math.floor(frame.uv[0] * texture.width),
		Math.floor((1 - frame.uv[1]) * texture.height),
	);
}

/**
 * Runs a Repeat Passes loop, its items' textures made lazily as they are
 * read: the initial ones from the Input's items, each next one by the
 * Output's from the current ones, as `start` and `next` passes draw them.
 * Returns the items as the loop ends, by texture id.
 */
function runLoop(model: GraphModel, frame: Frame, ref: LoopRef): ReadonlyMap<string, CpuTexture> {
	const { env } = frame;
	const key = `${loopId(ref)}@${scopeKey(env)}`;
	const done = env.finals.get(key);
	if (done) return done;
	const state = env.sources.loop(ref.path, ref.zone);
	if (!state) throw new Error(`no Repeat Passes zone "${ref.zone}"`);
	const id = loopId(ref);
	const outer = env.loops;
	const canvas = [frame.resolution[0], frame.resolution[1]] as const;
	const zoneFrame = frameAt(model, frame, ref.path, [0.5, 0.5], canvas);
	const start = zoneFrame.doc.nodesById.get(ref.zone);
	if (!start) throw new Error(`no Repeat Passes Input "${ref.zone}"`);
	const outputId = start.data.pairedOutput;
	const iterations = input(model, zoneFrame, start, ITERATIONS_HANDLE)[0] ?? 0;
	const count = Math.min(Math.max(0, Math.trunc(iterations)), zoneMaxIterations(start));

	/** The items' textures, each texel computed by the node `from` at the iteration `scope` is at. */
	const make = (
		scope: ReadonlyMap<string, LoopScope>,
		from: "start" | "next",
	): Map<string, CpuTexture> => {
		const textures = new Map<string, CpuTexture>();
		for (const item of state.items) {
			const { width, height } = inLoops(env, scope, () =>
				sizeOf(model, frame, item.size, item.like),
			);
			const type = isTexture(item.type) ? "vec4f" : valueType(item.type);
			const texels = new Map<number, Value>();
			textures.set(item.texture, {
				width,
				height,
				texel: (x, y) => {
					const index = y * width + x;
					const known = texels.get(index);
					if (known) return known;
					const uv = [(x + 0.5) / width, 1 - (y + 0.5) / height] as const;
					const value = inLoops(env, from === "start" ? outer : scope, () => {
						const at = frameAt(model, frame, ref.path, uv, [width, height]);
						const node = at.doc.nodesById.get(
							from === "start" ? ref.zone : (outputId ?? ""),
						);
						if (!node) throw new Error("a Repeat Passes boundary is missing");
						return storeTexel(input(model, at, node, item.item.id), type, item.format);
					});
					texels.set(index, value);
					return value;
				},
			});
		}
		return textures;
	};

	let current = make(new Map([...outer, [id, { iteration: 0, items: new Map() }]]), "start");
	for (let iteration = 0; iteration < count; iteration++) {
		const scope = new Map([...outer, [id, { iteration, items: current }]]);
		current = make(scope, "next");
	}
	env.finals.set(key, current);
	return current;
}

/** A value as the texel of `format` keeping it, read back as a colour. */
function packTexel(value: Value, type: WgslType, format: TextureFormat): Value {
	// Floats are colours, integers are kept as they are.
	const texel =
		scalarOf(format) === "f32"
			? fieldColor(coerce(value, type), type)
			: coerce(coerce(value, type), texelType(format));
	const channels = channelsOf(format);
	return texel.map((c, i) => {
		if (i >= channels) return i === 3 ? 1 : 0;
		return format === "rgba8unorm" ? Math.round(Math.min(Math.max(c, 0), 1) * 255) / 255 : c;
	});
}

/** A value as the colour it's rendered as (see codegen's `fieldColor`). */
function fieldColor(value: Value, type: WgslType): Value {
	const [x = 0, y = 0, z = 0, w = 0] = value;
	switch (typeComponents(type)) {
		case 1:
			return [x, x, x, 1];
		case 2:
			return [x, y, 0, 1];
		case 3:
			return [x, y, z, 1];
		case 4:
			return [x, y, z, w];
	}
}

/** What a node's Texture input reads, in `frame`. */
function textureInput(model: GraphModel, frame: Frame, node: GraphNode, id: string): CpuTexture {
	return textureOf(model, frame, readSource(frame.env.sources.input(frame.path, node.id, id)));
}

const levelsOf = (texture: CpuTexture) => texture.levels ?? 1;

const mipChains = new WeakMap<CpuTexture, CpuTexture[]>();

/** A texture's mip level: each texel a box filter of the level before it (see `mipWeights`). */
function mipLevel(texture: CpuTexture, level: number): CpuTexture {
	if (level <= 0) return texture;
	let chain = mipChains.get(texture);
	if (!chain) {
		chain = [texture];
		mipChains.set(texture, chain);
	}
	for (let n = chain.length; n <= level; n++) {
		const parent = chain[n - 1] ?? texture;
		const known = new Map<number, Value>();
		const width = Math.max(1, Math.floor(parent.width / 2));
		chain.push({
			width,
			height: Math.max(1, Math.floor(parent.height / 2)),
			texel: (x, y) => {
				const key = y * width + x;
				const done = known.get(key);
				if (done) return done;
				const mean = [0, 0, 0, 0];
				const column = mipWeights(parent.height, y);
				const row = mipWeights(parent.width, x);
				column.weights.forEach((wy, dy) => {
					row.weights.forEach((wx, dx) => {
						const texel = texelAt(parent, row.first + dx, column.first + dy);
						for (let c = 0; c < 4; c++)
							mean[c] = (mean[c] ?? 0) + (texel[c] ?? 0) * wx * wy;
					});
				});
				known.set(key, mean);
				return mean;
			},
		});
	}
	return chain[level] ?? texture;
}

/** A texel, its coordinates clamped into the texture. */
function texelAt(texture: CpuTexture, x: number, y: number): Value {
	const cx = Math.min(Math.max(x, 0), texture.width - 1);
	const cy = Math.min(Math.max(y, 0), texture.height - 1);
	return texture.texel(cx, cy);
}

/** Sample Texture's lookup: UV flipped to texture coordinates, extended, then filtered. */
function sampleTexture(
	texture: CpuTexture,
	uv: Value,
	interpolation: number,
	extension: number,
	level = 0,
): Value {
	const wanted = Math.min(Math.max(level, 0), levelsOf(texture) - 1);
	const base = Math.floor(wanted);
	const mix = wanted - base;
	const at = (n: number) => sampleLevel(mipLevel(texture, n), uv, interpolation, extension);
	// Between two levels, as a trilinear sampler reads them.
	return mix === 0
		? at(base)
		: at(base).map((c, i) => c * (1 - mix) + (at(base + 1)[i] ?? 0) * mix);
}

function sampleLevel(
	texture: CpuTexture,
	uv: Value,
	interpolation: number,
	extension: number,
): Value {
	let u = uv[0] ?? 0;
	let v = 1 - (uv[1] ?? 0);
	const outside = u < 0 || u > 1 || v < 0 || v > 1;
	const fract = (n: number) => n - Math.floor(n);
	if (extension === 1) [u, v] = [fract(u), fract(v)];
	if (extension === 2) {
		const mirror = (n: number) => 1 - Math.abs(fract(n * 0.5) * 2 - 1);
		[u, v] = [mirror(u), mirror(v)];
	}
	if (extension === 3 && outside) return [0, 0, 0, 0];
	const x = u * texture.width - 0.5;
	const y = v * texture.height - 0.5;
	if (interpolation === 1) return texelAt(texture, Math.round(x), Math.round(y));
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx = x - x0;
	const ty = y - y0;
	const mix = (a: Value, b: Value, t: number) => a.map((c, i) => c * (1 - t) + (b[i] ?? 0) * t);
	return mix(
		mix(texelAt(texture, x0, y0), texelAt(texture, x0 + 1, y0), tx),
		mix(texelAt(texture, x0, y0 + 1), texelAt(texture, x0 + 1, y0 + 1), tx),
		ty,
	);
}

/** A node's types in `frame`. */
function typesIn(model: GraphModel, frame: Frame, node: GraphNode): ResolvedNodeTypes {
	return model.typeResolver.resolveNodeTypes(
		node,
		frame.doc.edgesByTarget.get(node.id) ?? [],
		frame.bindings,
	);
}

const NO_BINDINGS: TypeBindings = {};

const descriptors = new WeakMap<GraphNode, ReturnType<GraphModel["resolveDescriptor"]>>();

/** A node's descriptor, remembered: resolving a group's takes a walk through its definition. */
function descriptorOf(model: GraphModel, node: GraphNode) {
	let descriptor = descriptors.get(node);
	if (!descriptor) {
		descriptor = model.resolveDescriptor(node);
		descriptors.set(node, descriptor);
	}
	return descriptor;
}

const textureEdges = new WeakMap<TypeBindings, WeakMap<object, boolean>>();

/** Whether an edge carries a texture, remembered: every pixel asks again. */
function carriesTexture(model: GraphModel, frame: Frame, edge: GraphDocumentEdge): boolean {
	let known = textureEdges.get(frame.bindings);
	if (!known) {
		known = new WeakMap();
		textureEdges.set(frame.bindings, known);
	}
	let answer = known.get(edge);
	if (answer === undefined) {
		answer = isTexture(model.typeResolver.inferHandleType(edge, frame.bindings));
		known.set(edge, answer);
	}
	return answer;
}

function input(model: GraphModel, frame: Frame, node: GraphNode, inputId: string): Value {
	const type = valueType(typesIn(model, frame, node).inputTypes[inputId] ?? "f32");
	const edge = frame.doc.edgesByTarget.get(node.id)?.find((e) => e.targetHandle === inputId);
	if (edge && carriesTexture(model, frame, edge)) {
		// Sampled at the pixel: a render exactly, other images stretched over the canvas.
		const source = readSource(
			frame.env.sources.output(frame.path, edge.source, edge.sourceHandle),
		);
		const texture = textureOf(model, frame, source);
		// A render made for this size is read at the pixel, any other is stretched over it.
		const exact =
			(source.kind === "render" || source.kind === "loop") &&
			texture.width === frame.resolution[0] &&
			texture.height === frame.resolution[1];
		const color = exact
			? texelAt(
					texture,
					Math.floor(frame.uv[0] * texture.width),
					Math.floor((1 - frame.uv[1]) * texture.height),
				)
			: sampleTexture(texture, [...frame.uv], 0, 0);
		return coerce(color, type);
	}
	if (edge)
		return coerce(
			output(model, frame, edge.source, edge.sourceHandle),
			type,
			outputType(model, frame, edge.source, edge.sourceHandle),
		);
	const stored =
		node.data.values?.[inputId] ?? descriptorOf(model, node).defaultData.values?.[inputId];
	const keys = componentKeys(type);
	return coerce(
		keys.map((k) => readComponent(stored, k)),
		type,
	);
}

function operands(model: GraphModel, frame: Frame, node: GraphNode, inputId: string): Value[] {
	const type = valueType(typesIn(model, frame, node).inputTypes[inputId] ?? "f32");
	const edges = frame.doc.edgesByTarget.get(node.id)?.filter((e) => e.targetHandle === inputId);
	return (edges ?? []).map((e) =>
		coerce(
			output(model, frame, e.source, e.sourceHandle),
			type,
			outputType(model, frame, e.source, e.sourceHandle),
		),
	);
}

/** The value type an output carries, which conversions to an input's type start from. */
function outputType(
	model: GraphModel,
	frame: Frame,
	nodeId: string,
	handleId: string,
): WgslType | undefined {
	const node = frame.doc.nodesById.get(nodeId);
	if (!node) return undefined;
	const type = typesIn(model, frame, node).resolvedOutputs.find((o) => o.id === handleId)?.type;
	return type === undefined ? undefined : valueType(type);
}

function output(model: GraphModel, frame: Frame, nodeId: string, handleId: string): Value {
	const key = `${nodeId}:${handleId}`;
	const done = frame.computed.get(key);
	if (done) return done;
	const value = compute(model, frame, nodeId, handleId);
	frame.computed.set(key, value);
	return value;
}

function compute(model: GraphModel, frame: Frame, nodeId: string, handleId: string): Value {
	const node = frame.doc.nodesById.get(nodeId);
	if (!node?.type) throw new Error(`no node "${nodeId}"`);
	const type = node.type;
	const get = (id: string) => input(model, frame, node, id);

	if (type === "group-input") {
		const value = frame.groupInputs.get(handleId);
		if (!value) throw new Error(`no value for group input "${handleId}"`);
		return value;
	}
	if (type === "node-group") {
		const inner = groupFrame(model, frame, node);
		const doc = inner.doc;
		const outputs = doc.nodes.filter((n) => n.type === "group-output");
		const out =
			outputs.find((n) =>
				doc.edgesByTarget.get(n.id)?.some((e) => e.targetHandle === handleId),
			) ?? outputs[0];
		if (!out) throw new Error("no group output");
		return input(model, inner, out, handleId);
	}
	if (type === REPEAT_INPUT) {
		const zone = frame.zones.get(nodeId);
		if (!zone) throw new Error(`repeat input "${nodeId}" read outside its zone`);
		if (handleId === ITERATION_HANDLE) return [zone.iteration];
		return zone.state.get(handleId) ?? [0];
	}
	if (type === REPEAT_OUTPUT) return runZone(model, frame, node).get(handleId) ?? [0];
	if (type === PASS_REPEAT_INPUT || type === PASS_REPEAT_OUTPUT) {
		return loopValue(model, frame, node, handleId);
	}

	switch (type) {
		case "resolution":
			return [...frame.resolution];
		case "uv":
			return [...frame.uv];
		case SAMPLE_TEXTURE: {
			const color = sampleTexture(
				textureInput(model, frame, node, "texture"),
				frame.doc.edgesByTarget.get(nodeId)?.some((e) => e.targetHandle === "uv")
					? get("uv")
					: [...frame.uv],
				get("interpolation")[0] ?? 0,
				get("extension")[0] ?? 0,
				get(SAMPLE_TEXTURE_LEVEL)[0] ?? 0,
			);
			return handleId === "alpha" ? [color[3] ?? 0] : color;
		}
		case LOAD_TEXEL: {
			const texture = textureInput(model, frame, node, "texture");
			const level = Math.min(
				Math.max(Math.trunc(get("level")[0] ?? 0), 0),
				levelsOf(texture) - 1,
			);
			const [x = 0, y = 0] = get("texel");
			return coerce(
				texelAt(mipLevel(texture, level), x, y),
				valueType(typesIn(model, frame, node).outputType),
			);
		}
		case TEXTURE_SIZE: {
			const texture = textureInput(model, frame, node, "texture");
			const levels = levelsOf(texture);
			if (handleId === "levels") return [levels];
			const level = Math.min(
				Math.max(Math.trunc(get(TEXTURE_SIZE_LEVEL)[0] ?? 0), 0),
				levels - 1,
			);
			const { width, height } = mipLevel(texture, level);
			return handleId === "texel"
				? [Math.fround(1 / width), Math.fround(1 / height)]
				: [width, height];
		}
		case "display-gamut-clip": {
			const [r = 0, g = 0, b = 0] = get("color");
			const clipped = clipToGamut({ r, g, b }, frame.colorSpace);
			return [clipped.r, clipped.g, clipped.b];
		}
	}

	const cpu = descriptorOf(model, node).cpu;
	if (!cpu) throw new Error(`can't evaluate a "${type}" node`);
	const resolved = typesIn(model, frame, node);
	const ctx: CpuCtx = {
		input: get,
		operands: (id) => operands(model, frame, node, id),
		isPresent: (id) =>
			frame.doc.edgesByTarget.get(nodeId)?.some((e) => e.targetHandle === id) ?? false,
		inputTypes: Object.fromEntries(
			Object.entries(resolved.inputTypes).map(([id, t]) => [id, valueType(t)]),
		),
		outputTypes: Object.fromEntries(
			resolved.resolvedOutputs.map((o) => [o.id, valueType(o.type)]),
		),
		outputType: valueType(resolved.outputType),
		resolvedInputs: resolved.resolvedInputs,
		data: node.data,
	};
	const outputs = cpu(ctx);
	for (const [id, value] of Object.entries(outputs)) frame.computed.set(`${nodeId}:${id}`, value);
	return outputs[handleId] ?? [0];
}

/** An output of a Repeat Passes boundary: the iteration, or an item read at the pixel. */
function loopValue(model: GraphModel, frame: Frame, node: GraphNode, handleId: string): Value {
	const zone = frame.env.sources.instance(frame.path)?.zones.zoneOfBoundary.get(node.id);
	if (zone === undefined) throw new Error(`"${node.id}" isn't in a paired zone`);
	if (handleId === ITERATION_HANDLE) {
		const scope = frame.env.loops.get(loopId({ path: frame.path, zone }));
		if (!scope) throw new Error(`repeat passes input "${zone}" read outside its loop`);
		return [scope.iteration];
	}
	const source = frame.env.sources.output(frame.path, node.id, handleId);
	if (source.kind !== "loop") throw new Error(`"${handleId}" isn't an item of "${zone}"`);
	const type = typesIn(model, frame, node).resolvedOutputs.find((o) => o.id === handleId)?.type;
	if (type === undefined || isTexture(type)) throw new Error(`"${handleId}" is a texture`);
	return coerce(texelAtPixel(textureOf(model, frame, source), frame), valueType(type));
}

/** Run a repeat zone to its end, as its loop does: every next value from the current ones. */
function runZone(model: GraphModel, frame: Frame, output: GraphNode): ReadonlyMap<string, Value> {
	const done = frame.finals.get(output.id);
	if (done) return done;
	const start = frame.doc.nodes.find(
		(n) => n.type === REPEAT_INPUT && n.data.pairedOutput === output.id,
	);
	if (!start) throw new Error(`no Repeat Input for "${output.id}"`);
	const items = zoneItems(output);
	const iterations = input(model, frame, start, ITERATIONS_HANDLE)[0] ?? 0;
	const count = Math.min(Math.max(0, Math.trunc(iterations)), zoneMaxIterations(start));
	let state: ReadonlyMap<string, Value> = new Map(
		items.map((item) => [item.id, input(model, frame, start, item.id)]),
	);
	for (let iteration = 0; iteration < count; iteration++) {
		const zones = new Map([...frame.zones, [start.id, { iteration, state }]]);
		const inner: Frame = { ...frame, zones, finals: new Map(), computed: new Map() };
		state = new Map(items.map((item) => [item.id, input(model, inner, output, item.id)]));
	}
	frame.finals.set(output.id, state);
	return state;
}
