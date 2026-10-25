<script lang="ts">
	import {
		type ColorMode,
		colorToLinear,
		decodeRgb,
		encodeRgb,
		enumValue,
		type Hsv,
		hsvToRgb,
		type InputValue,
		linearToColor,
		type NodeData,
		type NodeInputDef,
		type NodeWidget,
		readComponent,
		rgbToHsv,
	} from "$core";
	import { ColorValueRamp, ColorWheel } from "$theme";
	import { untrack } from "svelte";

	import { getGraphManager } from "../../graph-manager.svelte";

	type Components = [number, number, number];

	let {
		id,
		widget,
		data,
		inputs,
		defaults,
		connected,
		disabled,
	}: {
		id: string;
		widget: NodeWidget;
		data: NodeData;
		/** The node's inputs, for the variants of the mode's enum. */
		inputs: readonly NodeInputDef[];
		/** Values the node's inputs have until edited. */
		defaults: Readonly<Record<string, InputValue>> | undefined;
		/** Ids of the node's linked inputs, which the wheel leaves alone. */
		connected: ReadonlySet<string | null>;
		disabled: boolean;
	} = $props();

	const graph = getGraphManager();

	const EPSILON = 1e-6;
	const valueOf = (input: string) => data.values?.[input] ?? defaults?.[input];
	const modeKey = $derived.by(() => {
		const control = inputs.find((i) => i.id === widget.mode)?.control;
		const variants = control?.kind === "enum" ? control.variants : [];
		return String(enumValue(valueOf(widget.mode), variants));
	});
	const binding = $derived(widget.modes[modeKey]);
	const mode = $derived<ColorMode>(binding?.space ?? "rgb");
	/** The inputs holding the mode's components. */
	const componentInputs = $derived(binding?.components ?? ["", "", ""]);
	const components = $derived(
		componentInputs.map((c) => readComponent(valueOf(c), "_")) as Components,
	);

	// Kept apart from the values so a hue survives going through grey or
	// black in RGB or OKLch, as in Blender.
	let hsv = $state<Hsv>({ h: 0, s: 0, v: 0 });
	/** The components last written, to tell our own edits coming back from new ones. */
	let sent: { mode: string; components: Components } | undefined;

	function hsvOf(of: ColorMode, [x, y, z]: Components, previous: Hsv): Hsv {
		if (of === "hsv") {
			const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
			return { h: x - Math.floor(x), s: clamp01(y), v: clamp01(z) };
		}
		const next = rgbToHsv(encodeRgb(colorToLinear(of, [x, y, z])));
		if (next.v < EPSILON) return { ...previous, v: 0 };
		return next.s < EPSILON ? { ...next, h: previous.h } : next;
	}

	function componentsOf(next: Hsv): Components {
		if (mode === "hsv") return [next.h, next.s, next.v];
		const [, , hue] = components;
		const turns = mode === "oklch" ? hue / 360 : 0;
		return [...linearToColor(mode, decodeRgb(hsvToRgb(next)), turns)];
	}

	$effect.pre(() => {
		const current = components;
		const currentMode = mode;
		const ours =
			sent?.mode === modeKey &&
			sent.components.every((n, i) => Math.abs(n - (current[i] ?? n)) < EPSILON);
		if (ours) return;
		untrack(() => {
			hsv = hsvOf(currentMode, current, hsv);
		});
	});

	function set(patch: Partial<Hsv>) {
		hsv = { ...hsv, ...patch };
		const next = componentsOf(hsv);
		const written = components.map((n, i) =>
			connected.has(componentInputs[i] ?? "") ? n : (next[i] ?? n),
		) as Components;
		sent = { mode: modeKey, components: written };
		const values = { ...data.values };
		componentInputs.forEach((c, i) => {
			values[c] = written[i] ?? 0;
		});
		graph.updateNodeData(id, { values }, { retype: false });
	}

	const linked = (indices: number[]) =>
		indices.every((i) => connected.has(componentInputs[i] ?? ""));
	// In HSV the wheel is hue and saturation, the ramp value; otherwise both
	// write all three components.
	const wheelDisabled = $derived(disabled || linked(mode === "hsv" ? [0, 1] : [0, 1, 2]));
	const rampDisabled = $derived(disabled || linked(mode === "hsv" ? [2] : [0, 1, 2]));
</script>

<div class="nodrag nowheel flex gap-2 py-1">
	<ColorWheel class="min-w-0 flex-1" {hsv} disabled={wheelDisabled} onchange={set} />
	<ColorValueRamp
		{hsv}
		disabled={rampDisabled}
		onchange={(v: number) => {
			set({ v });
		}}
	/>
</div>
