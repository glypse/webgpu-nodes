import { frameInterval } from "../assets/assets";
import {
	identSuffix,
	scalarNumber,
	type UniformInput,
	uniformName,
	type UniformValue,
	uniformValue,
} from "../codegen/literals";
import { ROOT_ID } from "../graph/document";
import { componentKeys, readComponent } from "../graph/values";
import { coerce, convert } from "../nodes/cpu";
import { nodeRegistry } from "../nodes/registry";
import {
	TEXTURE_SIZE,
	TEXTURE_SIZE_LEVEL,
	VIDEO,
	VIDEO_INTERVAL,
	VIDEO_METADATA,
} from "../nodes/texture";
import { iterationSource, loopId } from "../passes/loop";
import {
	readSource,
	type TextureGraph,
	type TextureSource,
	TextureSources,
} from "../passes/sources";
import type { FrameArg, Size } from "../passes/textures";
import {
	inputControl,
	isTexture,
	isUniformControl,
	makeType,
	type NodeData,
	type NodeInputDef,
	typeComponents,
	typeKind,
	type Value,
	valueType,
	type WgslType,
} from "../types";
import {
	ITERATION_HANDLE,
	ITERATIONS_HANDLE,
	PASS_REPEAT_INPUT,
	REPEAT_INPUT,
	zoneItems,
	zoneKindOf,
	zoneMaxIterations,
} from "../zones";
import type { FrameValueAnalysis } from "./analysis";

/**
 * Where a frame program reads what only the runtime knows. `iteration:` and
 * `texture-size:` name a loop of the plan and a resource, `uniform:` an
 * input value that's a uniform (so editing it doesn't recompile).
 */
export type FrameSource =
	| "time"
	| "delta"
	| "frame"
	| "canvas"
	| "pass-size"
	| `iteration:${string}`
	| `texture-size:${string}`
	| `uniform:${string}`;

/** An output of a step of a frame program, or one component of it. */
export type FrameRef = { step: number; output: string; component?: number };

/**
 * What a step reads: a literal, a step's output, a source, or a repeat
 * zone's state. `type` is the type of the value read, which the step
 * converts to the one it wants as WGSL does (a float saturates to an
 * integer). A `texture-size:` source reads a size and its mip levels as
 * three numbers, and is not converted.
 */
export type FrameInput =
	| { literal: Value; type: WgslType }
	| { ref: FrameRef; type: WgslType }
	| { source: FrameSource; type: WgslType }
	| { loop: string; item: string; type: WgslType };

type StepBase = {
	/** The repeat step whose body it's in, which runs it instead of the program. */
	loop?: string;
};

/** A node computed by its descriptor's `cpu`. */
export type NodeStep = StepBase & {
	kind: "node";
	type: string;
	data: NodeData;
	inputTypes: Record<string, WgslType>;
	outputTypes: Record<string, WgslType>;
	outputType: WgslType;
	resolvedInputs: NodeInputDef[];
	inputs: Record<string, FrameInput>;
	operands: Record<string, FrameInput[]>;
	/** The inputs something feeds. */
	present: string[];
};

/** A repeat zone run on the CPU: its body is the steps naming `id` as their loop. */
export type RepeatStep = StepBase & {
	kind: "repeat";
	id: string;
	iterations: FrameInput;
	max: number;
	items: { id: string; type: WgslType; initial: FrameInput; next: FrameInput }[];
};

export type FrameStep =
	| NodeStep
	| RepeatStep
	/** A source or loop value given as an output, `value`, converted to `type` if given. */
	| (StepBase & { kind: "read"; input: FrameInput; type?: WgslType })
	/**
	 * A texture's size at a mip level (`size`), the step from one texel to the
	 * next (`texel`) and how many levels it has (`levels`).
	 */
	| (StepBase & { kind: "texel"; size: FrameInput; level?: FrameInput });

/** The frame values a plan needs, as steps each reading others, never itself. */
export type FrameProgram = { steps: FrameStep[] };

export const EMPTY_FRAME_PROGRAM: FrameProgram = { steps: [] };

/** What a frame program's sources are while a pass is drawn. */
export type FrameEnv = {
	time: number;
	delta: number;
	frame: number;
	canvas: Size;
	/** The size of the pass being drawn. */
	passSize: Size;
	/** The current iteration of each loop of the plan, by id. */
	iteration?: (loop: string) => number | undefined;
	/** The size of a resource's texture, by id, and how many mip levels it has (one without). */
	textureSize?: (resource: string) => (Size & { levels?: number }) | undefined;
	/** The values of uniform inputs, by name. */
	uniforms?: Readonly<Record<string, number | readonly number[]>>;
};

/** The inputs a step reads. */
function inputsOf(step: FrameStep): FrameInput[] {
	switch (step.kind) {
		case "node":
			return [...Object.values(step.inputs), ...Object.values(step.operands).flat()];
		case "read":
			return [step.input];
		case "texel":
			return step.level ? [step.size, step.level] : [step.size];
		case "repeat":
			return [step.iterations, ...step.items.flatMap((i) => [i.initial, i.next])];
	}
}

/** What values of a frame program read that changes while a frame is drawn, or that passes make. */
export type FrameDependencies = {
	/** The loops whose iteration they read. */
	loops: Set<string>;
	/** The resources whose size they read. */
	textures: Set<string>;
};

/** What the values `refs` of `program` depend on, through the steps they read. */
export function frameDependencies(
	program: FrameProgram,
	refs: Iterable<FrameRef>,
): FrameDependencies {
	const found: FrameDependencies = { loops: new Set(), textures: new Set() };
	const seen = new Set<number>();
	const visit = (step: number) => {
		if (seen.has(step)) return;
		seen.add(step);
		const decl = program.steps[step];
		if (!decl) return;
		for (const input of inputsOf(decl)) {
			if ("ref" in input) {
				visit(input.ref.step);
			} else if ("source" in input) {
				const [kind, ...rest] = input.source.split(":");
				if (kind === "iteration") found.loops.add(rest.join(":"));
				if (kind === "texture-size") found.textures.add(rest.join(":"));
			}
		}
	};
	for (const ref of refs) visit(ref.step);
	return found;
}

function sourceValue(source: FrameSource, env: FrameEnv): Value {
	switch (source) {
		case "time":
			return [env.time];
		case "delta":
			return [env.delta];
		case "frame":
			return [env.frame];
		case "canvas":
			return [env.canvas.width, env.canvas.height];
		case "pass-size":
			return [env.passSize.width, env.passSize.height];
	}
	const [kind, ...rest] = source.split(":");
	const id = rest.join(":");
	if (kind === "iteration") return [env.iteration?.(id) ?? 0];
	if (kind === "texture-size") {
		const size = env.textureSize?.(id) ?? { width: 1, height: 1 };
		return [size.width, size.height, size.levels ?? 1];
	}
	const uniform = env.uniforms?.[id];
	return uniform === undefined ? [0] : typeof uniform === "number" ? [uniform] : [...uniform];
}

/**
 * The steps each loop runs, those of loops nested in it included, by loop id.
 * Worked out once per program so an iteration doesn't scan every step.
 * Rust: a dense Vec of step ranges per loop, built when the program is.
 */
const BODIES = new WeakMap<FrameProgram, ReadonlyMap<string, readonly number[]>>();

function loopBodies(program: FrameProgram): ReadonlyMap<string, readonly number[]> {
	const known = BODIES.get(program);
	if (known) return known;
	const direct = new Map<string, number[]>();
	program.steps.forEach((step, index) => {
		if (step.loop !== undefined)
			direct.set(step.loop, [...(direct.get(step.loop) ?? []), index]);
	});
	const bodies = new Map<string, readonly number[]>();
	const collect = (loop: string, visiting: ReadonlySet<string>): readonly number[] => {
		const done = bodies.get(loop);
		if (done) return done;
		const own = direct.get(loop) ?? [];
		const nested = own.flatMap((index) => {
			const step = program.steps[index];
			return step?.kind === "repeat" && !visiting.has(step.id)
				? collect(step.id, new Set([...visiting, loop]))
				: [];
		});
		const all = [...own, ...nested];
		bodies.set(loop, all);
		return all;
	};
	for (const loop of direct.keys()) collect(loop, new Set());
	BODIES.set(program, bodies);
	return bodies;
}

type Loop = { iteration: number; state: ReadonlyMap<string, Value> };

const NO_OUTPUTS: Readonly<Record<string, Value>> = {};

/**
 * The values of a frame program, each computed by its node's `cpu` when
 * first asked for and kept: what isn't asked for isn't computed, nor is
 * what only it reads (a texture's size, say, which the runtime may not
 * know yet). The env's sources are read when a value needs them, so it has
 * to be as it was until the values wanted are read.
 *
 * A repeat step computes its body's steps again for each iteration.
 * Rust: evaluate on demand with a dense Vec of steps and a generation
 * counter instead of clearing memos.
 */
export class FrameValues {
	private memo: (Readonly<Record<string, Value>> | undefined)[] = [];
	private computing = new Set<number>();
	private loops = new Map<string, Loop>();
	private bodies: ReadonlyMap<string, readonly number[]>;

	constructor(
		private program: FrameProgram,
		private env: FrameEnv,
	) {
		this.bodies = loopBodies(program);
	}

	/** The outputs of a step, by id. */
	stepOutputs(step: number): Readonly<Record<string, Value>> {
		const known = this.memo[step];
		if (known) return known;
		const decl = this.program.steps[step];
		// A step asked for while it is being computed reads itself.
		if (!decl || this.computing.has(step)) return NO_OUTPUTS;
		this.computing.add(step);
		const outputs = this.compute(decl);
		this.computing.delete(step);
		// Outside its loop's run a body step has no iteration to belong to.
		if (decl.loop === undefined || this.loops.has(decl.loop)) this.memo[step] = outputs;
		return outputs;
	}

	/** The value of a step's output. */
	ref({ step, output, component }: FrameRef): Value {
		const value = this.stepOutputs(step)[output] ?? [0];
		return component === undefined ? value : [value[component] ?? 0];
	}

	/** A number of the program: a literal, or one component of a step's output. */
	arg(arg: FrameArg): number {
		// A reference to a component is that component alone.
		return typeof arg === "number" ? arg : (this.ref(arg.frame)[0] ?? 0);
	}

	private read(input: FrameInput): Value {
		if ("literal" in input) return input.literal;
		if ("ref" in input) return this.ref(input.ref);
		if ("source" in input) return sourceValue(input.source, this.env);
		const loop = this.loops.get(input.loop);
		if (input.item === ITERATION_HANDLE) return [loop?.iteration ?? 0];
		return loop?.state.get(input.item) ?? [0];
	}

	private readAs(input: FrameInput, type: WgslType): Value {
		return convert(this.read(input), input.type, type);
	}

	private forget(loop: string) {
		for (const index of this.bodies.get(loop) ?? []) this.memo[index] = undefined;
	}

	private compute(step: FrameStep): Readonly<Record<string, Value>> {
		switch (step.kind) {
			case "node":
				return this.runNode(step);
			case "read":
				return {
					value: step.type ? this.readAs(step.input, step.type) : this.read(step.input),
				};
			case "texel": {
				const [base = 1, tall = 1, levels = 1] = this.read(step.size);
				const wanted = step.level ? (this.readAs(step.level, "i32")[0] ?? 0) : 0;
				const level = Math.min(Math.max(wanted, 0), levels - 1);
				const width = Math.max(1, Math.floor(base / 2 ** level));
				const height = Math.max(1, Math.floor(tall / 2 ** level));
				return {
					size: [width, height],
					texel: [Math.fround(1 / width), Math.fround(1 / height)],
					levels: [levels],
				};
			}
			case "repeat":
				return this.runRepeat(step);
		}
	}

	private runNode(step: NodeStep): Record<string, Value> {
		const cpu = nodeRegistry[step.type]?.cpu;
		if (!cpu) throw new Error(`no CPU implementation for a "${step.type}" node`);
		const present = new Set(step.present);
		return cpu({
			input: (id) => {
				const input = step.inputs[id];
				return input ? this.readAs(input, step.inputTypes[id] ?? "f32") : [0];
			},
			operands: (id) =>
				(step.operands[id] ?? []).map((i) => this.readAs(i, step.inputTypes[id] ?? "f32")),
			isPresent: (id) => present.has(id),
			inputTypes: step.inputTypes,
			outputTypes: step.outputTypes,
			outputType: step.outputType,
			resolvedInputs: step.resolvedInputs,
			data: step.data,
		});
	}

	private runRepeat(step: RepeatStep): Record<string, Value> {
		const count = Math.min(Math.max(0, this.readAs(step.iterations, "i32")[0] ?? 0), step.max);
		let state: ReadonlyMap<string, Value> = new Map(
			step.items.map((i) => [i.id, this.readAs(i.initial, i.type)]),
		);
		for (let iteration = 0; iteration < count; iteration++) {
			this.loops.set(step.id, { iteration, state });
			this.forget(step.id);
			state = new Map(step.items.map((i) => [i.id, this.readAs(i.next, i.type)]));
		}
		this.loops.delete(step.id);
		this.forget(step.id);
		return Object.fromEntries(state);
	}
}

/** The values of a frame program: each step by its node's `cpu`, so the CPU and the GPU agree. */
export function evaluateFrame(program: FrameProgram, env: FrameEnv): FrameValues {
	return new FrameValues(program, env);
}

/** What compiling a value gives: where to read it, and whether it varies with anything at runtime. */
export type CompiledFrameValue = { input: FrameInput; dynamic: boolean };

export type FrameCompilerOptions = {
	/** The definitions (`ROOT_ID` for the root) whose unlinked input values are uniforms. */
	uniformScopes?: ReadonlySet<string>;
	/** Whether Texture Size may be read (a plan has to know the texture it reads). */
	textureSize?: boolean;
};

const literal = (value: Value, type: WgslType): CompiledFrameValue => ({
	input: { literal: value, type },
	dynamic: false,
});

/** The loop a read step runs in: the one whose state it reads, or its source step's. */
function readLoop(steps: readonly FrameStep[], input: FrameInput): { loop?: string } {
	const loop =
		"loop" in input ? input.loop : "ref" in input ? steps[input.ref.step]?.loop : undefined;
	return loop === undefined ? {} : { loop };
}

/**
 * Compiles the frame values of a graph into one `FrameProgram`, which
 * shaders' hoisted values and passes' sizes read their numbers from. Values
 * made only of literals are folded while compiling.
 */
export class FrameCompiler {
	/** The values of the uniforms its program reads. */
	readonly uniforms: Record<string, UniformValue> = {};
	/** The inputs they hold, by name. */
	readonly uniformInputs = new Map<string, UniformInput>();
	private steps: FrameStep[] = [];
	private dynamics: boolean[] = [];
	private memo = new Map<string, CompiledFrameValue | undefined>();
	private zones = new Map<string, number>();
	private uniformScopes: ReadonlySet<string>;
	private textureSize: boolean;
	private sized = new Map<string, TextureSource>();

	constructor(
		private graph: TextureGraph,
		readonly analysis: FrameValueAnalysis,
		private sources: TextureSources = new TextureSources(graph),
		{ uniformScopes = new Set(), textureSize = true }: FrameCompilerOptions = {},
	) {
		this.uniformScopes = uniformScopes;
		this.textureSize = textureSize;
		sources.sizing = this;
	}

	/** The textures whose sizes the program reads: they must exist for it to be evaluated. */
	sizedTextures(): TextureSource[] {
		return [...this.sized.values()];
	}

	/** The program of everything compiled so far. */
	program(): FrameProgram {
		return { steps: [...this.steps] };
	}

	/**
	 * An output of a node of the document computed at `path`, if it's a frame
	 * value this can compile (not one reading a texture's size, when that's off).
	 */
	compile(
		path: readonly string[],
		nodeId: string,
		handleId: string,
	): CompiledFrameValue | undefined {
		const key = `${path.join("/")}|${nodeId}|${handleId}`;
		if (this.memo.has(key)) return this.memo.get(key);
		const result = this.analysis.isFrameValue(path, nodeId, handleId)
			? this.compileOutput(path, nodeId, handleId)
			: undefined;
		this.memo.set(key, result);
		return result;
	}

	/**
	 * The program output giving a node's value, when it varies with what the
	 * runtime knows: one a shader can read from the frame block.
	 */
	hoist(path: readonly string[], nodeId: string, handleId: string): FrameRef | undefined {
		const value = this.compile(path, nodeId, handleId);
		if (!value?.dynamic) return undefined;
		return "ref" in value.input ? value.input.ref : this.read(value.input);
	}

	private read(input: FrameInput, type?: WgslType): FrameRef {
		const step: FrameStep = {
			kind: "read",
			input,
			...(type === undefined ? {} : { type }),
			...readLoop(this.steps, input),
		};
		return this.push(step, true, "value");
	}

	/** The same, as a number a plan can carry: a component of the value. */
	arg(
		path: readonly string[],
		nodeId: string,
		handleId: string,
		component = 0,
	): FrameArg | undefined {
		const value = this.compile(path, nodeId, handleId);
		return value && this.asArg(value, component);
	}

	/** What a node's input reads, as a number a plan can carry: the stored value when unlinked. */
	inputArg(
		path: readonly string[],
		nodeId: string,
		inputId: string,
		component = 0,
	): FrameArg | undefined {
		const value = this.input(path, nodeId, inputId);
		return value && this.asArg(value, component);
	}

	private asArg({ input }: CompiledFrameValue, component: number): FrameArg {
		if ("literal" in input) return input.literal[component] ?? 0;
		const ref = "ref" in input ? input.ref : this.read(input);
		return { frame: { ...ref, component } };
	}

	private push(step: FrameStep, dynamic: boolean, output: string): FrameRef {
		this.steps.push(step);
		this.dynamics.push(dynamic);
		return { step: this.steps.length - 1, output };
	}

	private isDynamic({ input }: { input: FrameInput }): boolean {
		if ("literal" in input) return false;
		if ("ref" in input) return this.dynamics[input.ref.step] ?? true;
		return true;
	}

	private ref(ref: FrameRef, type: WgslType): CompiledFrameValue {
		return { input: { ref, type }, dynamic: this.dynamics[ref.step] ?? true };
	}

	/** `value` as `type`, through a step when it's not known now. */
	private cast(value: CompiledFrameValue | undefined, type: WgslType | undefined) {
		if (!value || type === undefined || value.input.type === type) return value;
		const { input } = value;
		if ("literal" in input) return literal(convert(input.literal, input.type, type), type);
		return this.ref(this.read(input, type), type);
	}

	private outputType(
		path: readonly string[],
		nodeId: string,
		handleId: string,
	): WgslType | undefined {
		const instance = this.sources.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node) return undefined;
		const type = this.graph.typeResolver
			.resolveNodeTypes(node, instance.doc.edgesByTarget.get(nodeId) ?? [], instance.bindings)
			.resolvedOutputs.find((o) => o.id === handleId)?.type;
		return type === undefined || isTexture(type) ? undefined : valueType(type);
	}

	private iterations = new Map<string, FrameRef>();

	/** The value of the iteration a Repeat Passes loop is at, for a shader to read. */
	iteration(loop: string): FrameRef {
		let ref = this.iterations.get(loop);
		if (!ref) {
			ref = this.push(
				{
					kind: "read",
					input: { source: iterationSource(loop), type: "i32" },
				},
				true,
				"value",
			);
			this.iterations.set(loop, ref);
		}
		return ref;
	}

	/**
	 * The innermost repeat zone around `zone` of the document at `path`, else
	 * the one around the group node that document is the instance of, and so on up.
	 */
	private enclosingLoop(path: readonly string[], zone: string | null | undefined) {
		let at = path;
		let current = zone;
		for (;;) {
			const zones = this.sources.instance(at)?.zones;
			for (; current; current = zones?.zones.get(current)?.parent) {
				if (zones?.zones.get(current)?.kind === "repeat")
					return `${at.join("/")}|${current}`;
			}
			const group = at.at(-1);
			if (group === undefined) return undefined;
			at = at.slice(0, -1);
			current = this.sources.instance(at)?.zones.nodeZone.get(group);
		}
	}

	/** The loop a node of the document at `path` runs in, if it's in a repeat zone. */
	private loopOf(path: readonly string[], nodeId: string): string | undefined {
		return this.enclosingLoop(path, this.sources.instance(path)?.zones.nodeZone.get(nodeId));
	}

	private compileOutput(
		path: readonly string[],
		nodeId: string,
		handleId: string,
	): CompiledFrameValue | undefined {
		const instance = this.sources.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node?.type) return undefined;
		const source = (s: FrameSource, type: WgslType): CompiledFrameValue => ({
			input: { source: s, type },
			dynamic: true,
		});
		const own = this.outputType(path, nodeId, handleId);
		switch (node.type) {
			case "time":
				return handleId === "frame" ? source("frame", "i32") : source("time", "f32");
			case "delta":
				return source("delta", "f32");
			case "resolution":
				return source("pass-size", "vec2f");
			case TEXTURE_SIZE: {
				if (!this.textureSize) return undefined;
				const texture = this.sources.input(path, nodeId, "texture");
				const read = readSource(texture);
				if (read.kind !== "empty") this.sized.set(read.id, read);
				const size = { source: `texture-size:${texture.id}`, type: "vec3f" } as const;
				const level = this.input(path, nodeId, TEXTURE_SIZE_LEVEL);
				if (!level) return undefined;
				const ref = this.push(
					{ kind: "texel", size, level: level.input, loop: this.loopOf(path, nodeId) },
					true,
					handleId,
				);
				return this.ref(ref, own ?? "vec2f");
			}
			case VIDEO: {
				if (!VIDEO_METADATA.has(handleId)) return undefined;
				const asset = this.graph.assets.find((a) => a.id === node.data.asset);
				if (handleId === VIDEO_INTERVAL) return literal([frameInterval(asset)], "f32");
				return literal([Math.fround(asset?.kind === "video" ? asset.duration : 0)], "f32");
			}
			case "group-input": {
				const parent = path.at(-1);
				return parent === undefined
					? undefined
					: this.cast(this.input(path.slice(0, -1), parent, handleId), own);
			}
			case "node-group": {
				const definition =
					node.group && this.graph.project.definitions.get(node.group.definitionRef);
				const outputs = definition?.nodes.filter((n) => n.type === "group-output") ?? [];
				const out =
					outputs.find((n) =>
						definition?.edgesByTarget
							.get(n.id)
							?.some((e) => e.targetHandle === handleId),
					) ?? outputs[0];
				return out
					? this.cast(this.input([...path, nodeId], out.id, handleId), own)
					: undefined;
			}
			case "reroute":
				return this.cast(this.input(path, nodeId, "in"), own);
		}
		if (node.type === PASS_REPEAT_INPUT && handleId === ITERATION_HANDLE) {
			const zone = instance.zones.zoneOfBoundary.get(nodeId);
			return zone === undefined
				? undefined
				: source(iterationSource(loopId({ path, zone })), "i32");
		}
		const kind = zoneKindOf(node.type);
		if (kind === "repeat") return this.compileZoneValue(path, nodeId, handleId);
		if (kind) return undefined;
		return this.compileNode(path, nodeId, handleId);
	}

	/** What a node's input reads: its link's value, or its stored one. */
	private input(
		path: readonly string[],
		nodeId: string,
		inputId: string,
	): CompiledFrameValue | undefined {
		const instance = this.sources.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node) return undefined;
		const edge = instance.edgesByTarget.get(nodeId)?.find((e) => e.targetHandle === inputId);
		if (edge && !this.analysis.isRefused(path, edge)) {
			return this.compile(path, edge.source, edge.sourceHandle);
		}
		return this.unlinked(path, nodeId, inputId);
	}

	/** An unlinked input's value: a uniform where inputs are, else a literal. */
	private unlinked(
		path: readonly string[],
		nodeId: string,
		inputId: string,
	): CompiledFrameValue | undefined {
		const instance = this.sources.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node) return undefined;
		const descriptor = this.graph.resolveDescriptor(node);
		const types = this.graph.typeResolver.resolveNodeTypes(
			node,
			instance.doc.edgesByTarget.get(nodeId) ?? [],
			instance.bindings,
		);
		const type = types.inputTypes[inputId];
		if (type === undefined || isTexture(type)) return undefined;
		const stored = node.data.values?.[inputId] ?? descriptor.defaultData.values?.[inputId];
		const definition = path.length === 0 ? ROOT_ID : this.definitionOf(path);
		if (definition !== undefined && this.uniformScopes.has(definition)) {
			const def = descriptor.inputs.find((i) => i.id === inputId);
			if (!def || isUniformControl(inputControl(def, valueType(type)))) {
				const name = uniformName(nodeId, inputId);
				this.uniforms[name] = uniformValue(valueType(type), stored);
				this.uniformInputs.set(name, {
					node: nodeId,
					input: inputId,
					type: valueType(type),
					fallback: descriptor.defaultData.values?.[inputId],
				});
				// Uniforms are floats, converted to the input's type.
				const floats = makeType("f32", typeComponents(valueType(type)));
				return { input: { source: `uniform:${name}`, type: floats }, dynamic: true };
			}
		}
		const kind = typeKind(valueType(type));
		return literal(
			coerce(
				componentKeys(valueType(type)).map((k) =>
					scalarNumber(kind, readComponent(stored, k)),
				),
				valueType(type),
			),
			valueType(type),
		);
	}

	private definitionOf(path: readonly string[]): string | undefined {
		const parent = this.sources.instance(path.slice(0, -1));
		return parent?.doc.nodesById.get(path.at(-1) ?? "")?.group?.definitionRef;
	}

	private compileNode(
		path: readonly string[],
		nodeId: string,
		handleId: string,
	): CompiledFrameValue | undefined {
		const instance = this.sources.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node?.type) return undefined;
		const descriptor = this.graph.resolveDescriptor(node);
		if (!descriptor.cpu) return undefined;
		const incoming = instance.doc.edgesByTarget.get(nodeId) ?? [];
		const types = this.graph.typeResolver.resolveNodeTypes(node, incoming, instance.bindings);
		const inputs: Record<string, FrameInput> = {};
		const operands: Record<string, FrameInput[]> = {};
		for (const id of this.analysis.inputsRead(path, nodeId)) {
			const def = types.resolvedInputs.find((i) => i.id === id);
			if (def?.variadic) {
				const values = (instance.edgesByTarget.get(nodeId) ?? [])
					.filter((e) => e.targetHandle === id)
					.map((e) => this.compile(path, e.source, e.sourceHandle));
				if (values.some((v) => !v)) return undefined;
				operands[id] = values.flatMap((v) => (v ? [v.input] : []));
			} else {
				const value = this.input(path, nodeId, id);
				if (!value) return undefined;
				inputs[id] = value.input;
			}
		}
		const inputTypes = Object.fromEntries(
			Object.entries(types.inputTypes).flatMap(([id, t]) =>
				isTexture(t) ? [] : [[id, valueType(t)]],
			),
		);
		const step: NodeStep = {
			kind: "node",
			type: node.type,
			data: node.data,
			inputTypes,
			outputTypes: Object.fromEntries(
				types.resolvedOutputs.map((o) => [o.id, valueType(o.type)]),
			),
			outputType: valueType(types.outputType),
			resolvedInputs: types.resolvedInputs,
			inputs,
			operands,
			present: incoming.map((e) => e.targetHandle),
		};
		const dynamic = [...Object.values(inputs), ...Object.values(operands).flat()].some((i) =>
			this.isDynamic({ input: i }),
		);
		const typeOf = (id: string) => step.outputTypes[id] ?? "f32";
		if (!dynamic) {
			// Only literals: nothing the runtime or a loop knows is read, so it's known now.
			const folded = evaluateFrame({ steps: [step] }, EMPTY_ENV).stepOutputs(0);
			for (const [id, value] of Object.entries(folded)) {
				this.memo.set(`${path.join("/")}|${nodeId}|${id}`, literal(value, typeOf(id)));
			}
			return literal(folded[handleId] ?? [0], typeOf(handleId));
		}
		const loop = this.loopOf(path, nodeId);
		const ref = this.push(loop === undefined ? step : { ...step, loop }, dynamic, handleId);
		return this.ref(ref, typeOf(handleId));
	}

	/** An output of a repeat zone's boundary: an item's current value, or its final one. */
	private compileZoneValue(
		path: readonly string[],
		nodeId: string,
		handleId: string,
	): CompiledFrameValue | undefined {
		const instance = this.sources.instance(path);
		const zoneId = instance?.zones.zoneOfBoundary.get(nodeId);
		const zone = zoneId === undefined ? undefined : instance?.zones.zones.get(zoneId);
		const start = instance?.doc.nodesById.get(zone?.inputId ?? "");
		if (!instance || !zone || !start) return undefined;
		const loop = `${path.join("/")}|${zone.id}`;
		const output = instance.doc.nodesById.get(zone.outputId);
		const outputs = output
			? this.graph.typeResolver.resolveNodeTypes(
					output,
					instance.doc.edgesByTarget.get(output.id) ?? [],
					instance.bindings,
				).resolvedOutputs
			: [];
		const itemType = (id: string) => {
			const type = outputs.find((o) => o.id === id)?.type;
			return type === undefined || isTexture(type) ? undefined : valueType(type);
		};
		if (instance.doc.nodesById.get(nodeId)?.type === REPEAT_INPUT) {
			const type = handleId === ITERATION_HANDLE ? "i32" : itemType(handleId);
			return type === undefined
				? undefined
				: { input: { loop, item: handleId, type }, dynamic: true };
		}
		let index = this.zones.get(loop);
		if (index === undefined) {
			const iterations = this.input(path, zone.inputId, ITERATIONS_HANDLE);
			const items: RepeatStep["items"] = [];
			for (const item of zoneItems(output)) {
				const initial = this.input(path, zone.inputId, item.id);
				const next = this.input(path, zone.outputId, item.id);
				const type = itemType(item.id);
				if (!initial || !next || type === undefined) return undefined;
				items.push({ id: item.id, type, initial: initial.input, next: next.input });
			}
			if (!iterations) return undefined;
			const parent = this.enclosingLoop(path, zone.parent);
			index = this.push(
				{
					kind: "repeat",
					id: loop,
					iterations: iterations.input,
					max: zoneMaxIterations(start),
					items,
					...(parent === undefined ? {} : { loop: parent }),
				},
				true,
				handleId,
			).step;
			this.zones.set(loop, index);
		}
		const type = itemType(handleId);
		return type === undefined ? undefined : this.ref({ step: index, output: handleId }, type);
	}
}

const EMPTY_ENV: FrameEnv = {
	time: 0,
	delta: 0,
	frame: 0,
	canvas: { width: 1, height: 1 },
	passSize: { width: 1, height: 1 },
};

/** The WGSL identifier of a hoisted frame value's field. */
export function frameValueField(nodeId: string, handleId: string): string {
	return `f_${identSuffix(nodeId)}_${identSuffix(handleId)}`;
}
