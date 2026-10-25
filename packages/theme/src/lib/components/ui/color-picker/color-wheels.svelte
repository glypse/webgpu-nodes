<script lang="ts">
	import {
		type ColorMode,
		type ColorComponents,
		decodeRgb,
		type Hsv,
		hsvKeepingHue,
		hsvToRgb,
	} from "$core";
	import { untrack } from "svelte";

	import { cn } from "../../../utils.js";
	import ColorWheel from "./color-wheel.svelte";
	import OklchLightness from "./oklch-lightness.svelte";
	import OklchWheel from "./oklch-wheel.svelte";
	import ValueRamp from "./value-ramp.svelte";

	let {
		mode,
		components,
		locked = [false, false, false],
		disabled = false,
		onchange,
		class: className,
		wheelClass,
	}: {
		/** What `components` are: linear RGB, HSV (hue in [0, 1]) or OKLch (hue in degrees). */
		mode: ColorMode;
		components: ColorComponents;
		/** Components not to edit, e.g. linked ones. */
		locked?: readonly boolean[];
		disabled?: boolean;
		/** All three components; locked ones as they were. */
		onchange: (components: ColorComponents) => void;
		class?: string;
		wheelClass?: string;
	} = $props();

	const EPSILON = 1e-6;

	/** Components with `patch` applied, locked ones left as they are. */
	function patched(patch: Partial<Record<0 | 1 | 2, number>>): ColorComponents {
		return components.map((n, i) =>
			locked[i] ? n : (patch[i as 0 | 1 | 2] ?? n),
		) as unknown as ColorComponents;
	}

	// In RGB the wheel and ramp edit an HSV kept apart from the components, so
	// a hue survives going through grey or black.
	let hsv = $state<Hsv>({ h: 0, s: 0, v: 0 });
	/** The RGB last written, to tell our own edits coming back from new ones. */
	let sent: ColorComponents | undefined;

	$effect.pre(() => {
		if (mode !== "rgb") return;
		const current = components;
		const ours = sent?.every((n, i) => Math.abs(n - (current[i] ?? n)) < EPSILON);
		if (ours) return;
		untrack(() => {
			const [r, g, b] = current;
			hsv = hsvKeepingHue({ r, g, b }, hsv);
		});
	});

	function setRgbHsv(patch: Partial<Hsv>) {
		hsv = { ...hsv, ...patch };
		const { r, g, b } = decodeRgb(hsvToRgb(hsv));
		sent = [r, g, b];
		onchange(sent);
	}

	const [x, y, z] = $derived(components);
	const anyLocked = $derived(locked.some(Boolean));
	// Each control's own components: locked only when all of them are. In RGB
	// both rewrite all three, which means nothing once one is locked.
	const firstDisabled = $derived(
		disabled ||
			(mode === "rgb"
				? anyLocked
				: mode === "hsv"
					? !!locked[0] && !!locked[1]
					: !!locked[1] && !!locked[2]),
	);
	const secondDisabled = $derived(
		disabled || (mode === "rgb" ? anyLocked : mode === "hsv" ? !!locked[2] : !!locked[0]),
	);
</script>

<div class={cn("flex gap-2", className)}>
	{#if mode === "oklch"}
		<OklchWheel
			class={wheelClass}
			lch={{ l: x, c: y, h: z }}
			disabled={firstDisabled}
			onchange={({ c, h }: { c: number; h: number }) => {
				onchange(patched({ 1: c, 2: h }));
			}}
		/>
		<OklchLightness
			lch={{ l: x, c: y, h: z }}
			disabled={secondDisabled}
			onchange={(l: number) => {
				onchange(patched({ 0: l }));
			}}
		/>
	{:else if mode === "hsv"}
		<ColorWheel
			class={wheelClass}
			hsv={{ h: x, s: y, v: z }}
			disabled={firstDisabled}
			onchange={({ h, s }: Pick<Hsv, "h" | "s">) => {
				onchange(patched({ 0: h, 1: s }));
			}}
		/>
		<ValueRamp
			hsv={{ h: x, s: y, v: z }}
			disabled={secondDisabled}
			onchange={(v: number) => {
				onchange(patched({ 2: v }));
			}}
		/>
	{:else}
		<ColorWheel class={wheelClass} {hsv} disabled={firstDisabled} onchange={setRgbHsv} />
		<ValueRamp
			{hsv}
			disabled={secondDisabled}
			onchange={(v: number) => {
				setRgbHsv({ v });
			}}
		/>
	{/if}
</div>
