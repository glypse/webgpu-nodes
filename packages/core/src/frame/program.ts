import { identSuffix, uniformName, type UniformValue, uniformValue } from "../codegen/literals";
import { ROOT_ID } from "../graph/document";
import { componentKeys, readComponent } from "../graph/values";
import { coerce } from "../nodes/cpu";
import { nodeRegistry } from "../nodes/registry";
import { TEXTURE_SIZE } from "../nodes/texture";
import { type TextureGraph, TextureSources } from "../passes/sources";
import type { FrameArg, Size } from "../passes/textures";
import {
	inputControl,
	isTexture,
	isUniformControl,
	type NodeData,
	type NodeInputDef,
	type Value,
	valueType,
	type WgslType,
} from "../types";
import {
	ITERATION_HANDLE,
	ITERATIONS_HANDLE,
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

/** What a step reads: a literal, an earlier step's output, a source, or a repeat zone's state. */
export type FrameInput =
	| { literal: Value }
	| { ref: FrameRef }
	| { source: FrameSource }
	| { loop: string; item: string };

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
	/** A source or loop value given as an output, `value`. */
	| (StepBase & { kind: "read"; input: FrameInput })
	/** A texture's size (`size`) and the step from one texel to the next (`texel`). */
	| (StepBase & { kind: "texel"; size: FrameInput });

/** The frame values a plan needs, as steps in order each reading only earlier ones. */
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
	/** The size of a resource's texture, by id. */
	textureSize?: (resource: string) => Size | undefined;
	/** The values of uniform inputs, by name. */
	uniforms?: Readonly<Record<string, number | readonly number[]>>;
};

/** The outputs of the steps of a frame program, as evaluated. */
export class FrameValues {
	constructor(readonly outputs: readonly (Readonly<Record<string, Value>> | undefined)[]) {}

	/** The value of a step's output. */
	ref({ step, output, component }: FrameRef): Value {
		const value = this.outputs[step]?.[output] ?? [0];
		return component === undefined ? value : [value[component] ?? 0];
	}

	/** A number of the program: a literal, or one component of a step's output. */
	arg(arg: FrameArg): number {
		return typeof arg === "number" ? arg : (this.ref(arg.frame)[arg.frame.component ?? 0] ?? 0);
	}
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
		return [size.width, size.height];
	}
	const uniform = env.uniforms?.[id];
	return uniform === undefined ? [0] : typeof uniform === "number" ? [uniform] : [...uniform];
}

type Loop = { iteration: number; state: ReadonlyMap<string, Value> };

/** Run a frame program: each step by its node's `cpu`, so the CPU and the GPU agree. */
export function evaluateFrame(program: FrameProgram, env: FrameEnv): FrameValues {
	const outputs: (Record<string, Value> | undefined)[] = [];
	const loops = new Map<string, Loop>();

	const read = (input: FrameInput): Value => {
		if ("literal" in input) return input.literal;
		if ("ref" in input) return new FrameValues(outputs).ref(input.ref);
		if ("source" in input) return sourceValue(input.source, env);
		const loop = loops.get(input.loop);
		if (input.item === ITERATION_HANDLE) return [loop?.iteration ?? 0];
		return loop?.state.get(input.item) ?? [0];
	};

	const runNode = (step: NodeStep): Record<string, Value> => {
		const cpu = nodeRegistry[step.type]?.cpu;
		if (!cpu) throw new Error(`no CPU implementation for a "${step.type}" node`);
		const present = new Set(step.present);
		return cpu({
			input: (id) => {
				const input = step.inputs[id];
				return input ? coerce(read(input), step.inputTypes[id] ?? "f32") : [0];
			},
			operands: (id) =>
				(step.operands[id] ?? []).map((i) => coerce(read(i), step.inputTypes[id] ?? "f32")),
			isPresent: (id) => present.has(id),
			inputTypes: step.inputTypes,
			outputTypes: step.outputTypes,
			outputType: step.outputType,
			resolvedInputs: step.resolvedInputs,
			data: step.data,
		});
	};

	const run = (index: number) => {
		const step = program.steps[index];
		if (!step) return;
		switch (step.kind) {
			case "node":
				outputs[index] = runNode(step);
				break;
			case "read":
				outputs[index] = { value: read(step.input) };
				break;
			case "texel": {
				const [width = 1, height = 1] = read(step.size);
				outputs[index] = { size: [width, height], texel: [1 / width, 1 / height] };
				break;
			}
			case "repeat": {
				const count = Math.min(
					Math.max(0, Math.trunc(read(step.iterations)[0] ?? 0)),
					step.max,
				);
				let state: ReadonlyMap<string, Value> = new Map(
					step.items.map((i) => [i.id, coerce(read(i.initial), i.type)]),
				);
				for (let iteration = 0; iteration < count; iteration++) {
					loops.set(step.id, { iteration, state });
					runBody(step.id);
					state = new Map(step.items.map((i) => [i.id, coerce(read(i.next), i.type)]));
				}
				loops.delete(step.id);
				outputs[index] = Object.fromEntries(state);
				break;
			}
		}
	};

	const runBody = (loop: string | undefined) => {
		program.steps.forEach((step, index) => {
			if (step.loop === loop) run(index);
		});
	};

	runBody(undefined);
	return new FrameValues(outputs);
}

/** What compiling a value gives: where to read it, and whether it varies with anything at runtime. */
export type CompiledFrameValue = { input: FrameInput; dynamic: boolean };

export type FrameCompilerOptions = {
	/** The definitions (`ROOT_ID` for the root) whose unlinked input values are uniforms. */
	uniformScopes?: ReadonlySet<string>;
	/** Whether Texture Size may be read (a plan has to know the texture it reads). */
	textureSize?: boolean;
};

const literal = (value: Value): CompiledFrameValue => ({
	input: { literal: value },
	dynamic: false,
});

/**
 * Compiles the frame values of a graph into one `FrameProgram`, which
 * shaders' hoisted values and passes' sizes read their numbers from. Values
 * made only of literals are folded while compiling.
 */
export class FrameCompiler {
	/** The values of the uniforms its program reads. */
	readonly uniforms: Record<string, UniformValue> = {};
	private steps: FrameStep[] = [];
	private dynamics: boolean[] = [];
	private memo = new Map<string, CompiledFrameValue | undefined>();
	private zones = new Map<string, number>();
	private uniformScopes: ReadonlySet<string>;
	private textureSize: boolean;

	constructor(
		private graph: TextureGraph,
		private analysis: FrameValueAnalysis,
		private sources: TextureSources = new TextureSources(graph),
		{ uniformScopes = new Set(), textureSize = true }: FrameCompilerOptions = {},
	) {
		this.uniformScopes = uniformScopes;
		this.textureSize = textureSize;
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
		const ref = "ref" in input ? input.ref : this.push({ kind: "read", input }, true, "value");
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

	private ref(ref: FrameRef): CompiledFrameValue {
		return { input: { ref }, dynamic: this.dynamics[ref.step] ?? true };
	}

	/** The loop a node of the document at `path` runs in, if it's in a repeat zone. */
	private loopOf(path: readonly string[], nodeId: string): string | undefined {
		const zones = this.sources.instance(path)?.zones;
		const zone = zones?.nodeZone.get(nodeId);
		return zone && zones?.zones.get(zone)?.kind === "repeat"
			? `${path.join("/")}|${zone}`
			: undefined;
	}

	private compileOutput(
		path: readonly string[],
		nodeId: string,
		handleId: string,
	): CompiledFrameValue | undefined {
		const instance = this.sources.instance(path);
		const node = instance?.doc.nodesById.get(nodeId);
		if (!instance || !node?.type) return undefined;
		const source = (s: FrameSource): CompiledFrameValue => ({
			input: { source: s },
			dynamic: true,
		});
		switch (node.type) {
			case "time":
				return source(handleId === "frame" ? "frame" : "time");
			case "delta":
				return source("delta");
			case "resolution":
				return source("pass-size");
			case TEXTURE_SIZE: {
				if (!this.textureSize) return undefined;
				const texture = this.sources.input(path, nodeId, "texture");
				const size = { source: `texture-size:${texture.id}` } as const;
				const ref = this.push(
					{ kind: "texel", size, loop: this.loopOf(path, nodeId) },
					true,
					handleId,
				);
				return this.ref(ref);
			}
			case "group-input": {
				const parent = path.at(-1);
				return parent === undefined
					? undefined
					: this.input(path.slice(0, -1), parent, handleId);
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
				return out ? this.input([...path, nodeId], out.id, handleId) : undefined;
			}
			case "reroute":
				return this.input(path, nodeId, "in");
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
		if (edge) return this.compile(path, edge.source, edge.sourceHandle);
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
				return { input: { source: `uniform:${name}` }, dynamic: true };
			}
		}
		return literal(
			coerce(
				componentKeys(valueType(type)).map((k) => readComponent(stored, k)),
				valueType(type),
			),
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
		const loop = this.loopOf(path, nodeId);
		const dynamic = [...Object.values(inputs), ...Object.values(operands).flat()].some((i) =>
			this.isDynamic({ input: i }),
		);
		if (!dynamic && loop === undefined) {
			// Only literals: nothing the runtime knows is read, so it's known now.
			const folded = evaluateFrame({ steps: [step] }, EMPTY_ENV).outputs[0] ?? {};
			for (const [id, value] of Object.entries(folded)) {
				this.memo.set(`${path.join("/")}|${nodeId}|${id}`, literal(value));
			}
			return literal(folded[handleId] ?? [0]);
		}
		const ref = this.push(loop === undefined ? step : { ...step, loop }, dynamic, handleId);
		return this.ref(ref);
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
		if (instance.doc.nodesById.get(nodeId)?.type === REPEAT_INPUT) {
			return { input: { loop, item: handleId }, dynamic: true };
		}
		let index = this.zones.get(loop);
		if (index === undefined) {
			const output = instance.doc.nodesById.get(zone.outputId);
			const outputs = output
				? this.graph.typeResolver.resolveNodeTypes(
						output,
						instance.doc.edgesByTarget.get(output.id) ?? [],
						instance.bindings,
					).resolvedOutputs
				: [];
			const iterations = this.input(path, zone.inputId, ITERATIONS_HANDLE);
			const items: RepeatStep["items"] = [];
			for (const item of zoneItems(output)) {
				const initial = this.input(path, zone.inputId, item.id);
				const next = this.input(path, zone.outputId, item.id);
				const type = outputs.find((o) => o.id === item.id)?.type;
				if (!initial || !next || type === undefined || isTexture(type)) return undefined;
				items.push({
					id: item.id,
					type: valueType(type),
					initial: initial.input,
					next: next.input,
				});
			}
			if (!iterations) return undefined;
			const parent = zone.parent === null ? undefined : `${path.join("/")}|${zone.parent}`;
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
		return this.ref({ step: index, output: handleId });
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
