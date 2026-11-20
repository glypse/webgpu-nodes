import { clipToGamut } from "../color/display";
import type { GraphNode, HydratedGraphDocument } from "../graph/document";
import type { GraphModel } from "../graph/model";
import type { ColorSpace } from "../graph/settings";
import { componentKeys, readComponent } from "../graph/values";
import { coerce } from "../nodes/cpu";
import { SAMPLE_TEXTURE, TEXTURE_SIZE } from "../nodes/texture";
import { readSource, type TextureSource, TextureSources } from "../passes/sources";
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
	REPEAT_INPUT,
	REPEAT_OUTPUT,
	zoneItems,
	zoneMaxIterations,
} from "../zones";

/** An image as the evaluator reads it: straight-alpha linear RGBA texels, rows top first. */
export type CpuTexture = {
	width: number;
	height: number;
	texel(x: number, y: number): Value;
};

export type EvaluateOptions = {
	/** The pixel's coordinates (origin bottom-left, as the UV node gives them). */
	uv?: readonly [number, number];
	/** The images of the project's assets, by asset id. */
	images?: ReadonlyMap<string, CpuTexture>;
};

/** What every frame of one evaluation shares. */
type Env = {
	sources: TextureSources;
	images: ReadonlyMap<string, CpuTexture>;
	/** Values rendered to textures so far, by texture id. */
	renders: Map<string, CpuTexture>;
};

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
	{ uv = [0.5, 0.5], images = new Map() }: EvaluateOptions = {},
): Value {
	const env: Env = { sources: new TextureSources(model), images, renders: new Map() };
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
		bindings: {},
	};
}

/** The frame computing the group node `nodeId` of `frame`'s document, its inputs from there. */
function groupFrame(model: GraphModel, frame: Frame, node: GraphNode): Frame {
	const doc = node.group && model.project.definitions.get(node.group.definitionRef);
	if (!doc) throw new Error(`no definition for "${node.id}"`);
	const descriptor = model.resolveDescriptor(node);
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
		bindings: resolved.bindings ?? {},
	};
}

const EMPTY_IMAGE: CpuTexture = { width: 1, height: 1, texel: () => [0, 0, 0, 0] };

/** The image a texture source reads, rendering a value over the canvas when it's a render. */
function textureOf(model: GraphModel, frame: Frame, source: TextureSource): CpuTexture {
	if (source.kind === "media") return frame.env.images.get(source.asset) ?? EMPTY_IMAGE;
	// Simulations aren't run here: their state reads nothing.
	if (source.kind === "empty" || source.kind === "state") return EMPTY_IMAGE;
	const done = frame.env.renders.get(source.id);
	if (done) return done;
	const [width, height] = frame.resolution;
	const texels = new Map<number, Value>();
	const { target } = source;
	const texture: CpuTexture = {
		width,
		height,
		texel: (x, y) => {
			const key = y * width + x;
			const known = texels.get(key);
			if (known) return known;
			const uv = [(x + 0.5) / width, 1 - (y + 0.5) / height] as const;
			let at = rootFrame(model, frame.env, uv, frame.colorSpace, frame.resolution);
			for (const id of target.path) {
				const node = at.doc.nodesById.get(id);
				if (!node) throw new Error(`no group node "${id}"`);
				at = groupFrame(model, at, node);
			}
			const node = at.doc.nodesById.get(target.node);
			if (!node) throw new Error(`no node "${target.node}"`);
			const type = valueType(
				typesIn(model, at, node).resolvedOutputs.find((o) => o.id === target.handle)
					?.type ?? "f32",
			);
			const value = fieldColor(output(model, at, target.node, target.handle), type);
			texels.set(key, value);
			return value;
		},
	};
	frame.env.renders.set(source.id, texture);
	return texture;
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

function input(model: GraphModel, frame: Frame, node: GraphNode, inputId: string): Value {
	const type = valueType(typesIn(model, frame, node).inputTypes[inputId] ?? "f32");
	const edge = frame.doc.edgesByTarget.get(node.id)?.find((e) => e.targetHandle === inputId);
	if (edge && isTexture(model.typeResolver.inferHandleType(edge, frame.bindings))) {
		// Sampled at the pixel: a render exactly, other images stretched over the canvas.
		const source = readSource(
			frame.env.sources.output(frame.path, edge.source, edge.sourceHandle),
		);
		const texture = textureOf(model, frame, source);
		const color =
			source.kind === "render"
				? texelAt(
						texture,
						Math.floor(frame.uv[0] * texture.width),
						Math.floor((1 - frame.uv[1]) * texture.height),
					)
				: sampleTexture(texture, [...frame.uv], 0, 0);
		return coerce(color, type);
	}
	if (edge) return coerce(output(model, frame, edge.source, edge.sourceHandle), type);
	const stored =
		node.data.values?.[inputId] ?? model.resolveDescriptor(node).defaultData.values?.[inputId];
	const keys = componentKeys(type);
	return coerce(
		keys.map((k) => readComponent(stored, k)),
		type,
	);
}

function operands(model: GraphModel, frame: Frame, node: GraphNode, inputId: string): Value[] {
	const type = valueType(typesIn(model, frame, node).inputTypes[inputId] ?? "f32");
	const edges = frame.doc.edgesByTarget.get(node.id)?.filter((e) => e.targetHandle === inputId);
	return (edges ?? []).map((e) => coerce(output(model, frame, e.source, e.sourceHandle), type));
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
			);
			return handleId === "alpha" ? [color[3] ?? 0] : color;
		}
		case TEXTURE_SIZE: {
			const texture = textureInput(model, frame, node, "texture");
			return handleId === "texel"
				? [1 / texture.width, 1 / texture.height]
				: [texture.width, texture.height];
		}
		case "display-gamut-clip": {
			const [r = 0, g = 0, b = 0] = get("color");
			const clipped = clipToGamut({ r, g, b }, frame.colorSpace);
			return [clipped.r, clipped.g, clipped.b];
		}
	}

	const cpu = model.resolveDescriptor(node).cpu;
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
