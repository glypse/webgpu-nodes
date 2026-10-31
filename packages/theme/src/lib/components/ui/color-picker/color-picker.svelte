<script lang="ts" module>
	type Mode = "rgb" | "hsv" | "oklch";

	/** The fields last shown, kept for the next picker opened. */
	let lastMode: Mode = "hsv";
</script>

<script lang="ts">
	import {
		type ColorComponents,
		decodeRgb,
		type Hsv,
		hexToLinear,
		hsvKeepingHue,
		hsvToRgb,
		type Lch,
		lchKeepingHue,
		linearToHex,
		oklchToLinear,
		type Rgba,
	} from "$core";
	import EyedropperIcon from "phosphor-svelte/lib/EyedropperIcon";
	import { untrack } from "svelte";

	import { linearToCss } from "../../../color-css.js";
	import { getDisplayGamut } from "../../../color-gamut.js";
	import { cn } from "../../../utils.js";
	import Scrubbable from "../scrubbable.svelte";
	import ColorWheels from "./color-wheels.svelte";

	let {
		value,
		alpha = false,
		onchange,
		class: className,
	}: {
		/** Linear RGB, alpha. */
		value: Rgba;
		/** Edit the alpha too. */
		alpha?: boolean;
		onchange: (value: Rgba) => void;
		class?: string;
	} = $props();

	type EyeDropperApi = new () => { open: () => Promise<{ sRGBHex: string }> };
	// Not in every browser (e.g. Safari, Firefox): the button is hidden there.
	const EyeDropper =
		typeof window === "undefined"
			? undefined
			: (window as unknown as { EyeDropper?: EyeDropperApi }).EyeDropper;

	const MODES: { mode: Mode; label: string }[] = [
		{ mode: "rgb", label: "RGB" },
		{ mode: "hsv", label: "HSV" },
		{ mode: "oklch", label: "OKLch" },
	];
	let mode = $state<Mode>(lastMode);
	const gamut = getDisplayGamut();

	// HSV and OKLch are kept apart from `value` so a hue survives going
	// through grey (no hue) or black, as it does in Blender.
	let hsv = $state<Hsv>({ h: 0, s: 0, v: 0 });
	let lch = $state<Lch>({ l: 0, c: 0, h: 0 });
	/** The last value sent, to tell our own changes coming back from new ones. */
	let sent: Rgba | undefined;

	const EPSILON = 1e-6;
	const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
	const sameColor = (a: Rgba, b: Rgba) =>
		(["r", "g", "b", "a"] as const).every((k) => Math.abs(a[k] - b[k]) < EPSILON);

	$effect.pre(() => {
		const current = value;
		if (sent && sameColor(sent, current)) return;
		untrack(() => {
			hsv = hsvKeepingHue(current, hsv);
			lch = lchKeepingHue(current, lch);
		});
	});

	function commit(next: Rgba, keep: { hsv?: Hsv; lch?: Lch } = {}) {
		hsv = keep.hsv ?? hsvKeepingHue(next, hsv);
		lch = keep.lch ?? lchKeepingHue(next, lch);
		sent = next;
		onchange(next);
	}

	function setHsv(patch: Partial<Hsv>) {
		const next = { ...hsv, ...patch };
		commit({ ...decodeRgb(hsvToRgb(next)), a: value.a }, { hsv: next });
	}

	function setLch(patch: Partial<Lch>) {
		const next = { ...lch, ...patch };
		commit({ ...oklchToLinear(next, gamut()), a: value.a }, { lch: next });
	}

	const components = $derived<ColorComponents>(
		mode === "rgb"
			? [value.r, value.g, value.b]
			: mode === "hsv"
				? [hsv.h, hsv.s, hsv.v]
				: [lch.l, lch.c, lch.h],
	);

	function setComponents([x, y, z]: ColorComponents) {
		if (mode === "rgb") commit({ r: x, g: y, b: z, a: value.a });
		else if (mode === "hsv") setHsv({ h: x, s: y, v: z });
		else setLch({ l: x, c: y, h: z });
	}

	function setMode(next: Mode) {
		mode = next;
		lastMode = next;
	}

	let hexFocused = $state(false);
	let hexDraft = $state("");
	// In the colour space shown, as design tools write hex in their document's.
	const hex = $derived(linearToHex(value, alpha, gamut()));

	function commitHex() {
		const parsed = hexToLinear(hexDraft, gamut());
		const withAlpha = alpha && /^#?([\da-f]{4}|[\da-f]{8})$/i.test(hexDraft.trim());
		if (parsed) commit({ ...parsed, a: withAlpha ? parsed.a : value.a });
		hexFocused = false;
	}

	async function pickFromScreen() {
		if (!EyeDropper) return;
		try {
			const { sRGBHex } = await new EyeDropper().open();
			const picked = hexToLinear(sRGBHex);
			if (picked) commit({ ...picked, a: value.a });
		} catch {
			// Cancelled (Escape).
		}
	}
</script>

{#snippet field(label: string, current: number, set: (n: number) => void)}
	<div class="flex items-center">
		<span class="text-muted-foreground w-5 shrink-0 text-xs">{label}</span>
		<Scrubbable
			value={current}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				set(parseFloat(e.currentTarget.value) || 0);
			}}
		/>
	</div>
{/snippet}

<div class={cn("flex w-44 flex-col gap-2", className)}>
	<ColorWheels
		class="justify-center"
		wheelClass="size-32"
		{mode}
		{components}
		onchange={setComponents}
	/>

	<div class="bg-muted flex rounded-md p-0.5" role="tablist">
		{#each MODES as option (option.mode)}
			<button
				type="button"
				role="tab"
				aria-selected={mode === option.mode}
				class={cn(
					"flex-1 rounded-sm py-0.5 text-xs transition-colors",
					mode === option.mode
						? "bg-primary text-primary-foreground"
						: "text-muted-foreground hover:text-foreground",
				)}
				onclick={() => {
					setMode(option.mode);
				}}
			>
				{option.label}
			</button>
		{/each}
	</div>

	<div class="flex flex-col gap-px">
		{#if mode === "rgb"}
			{@render field("R", value.r, (r) => {
				commit({ ...value, r: Math.max(0, r) });
			})}
			{@render field("G", value.g, (g) => {
				commit({ ...value, g: Math.max(0, g) });
			})}
			{@render field("B", value.b, (b) => {
				commit({ ...value, b: Math.max(0, b) });
			})}
		{:else if mode === "hsv"}
			{@render field("H", hsv.h, (h) => {
				setHsv({ h: clamp(h, 0, 1) });
			})}
			{@render field("S", hsv.s, (s) => {
				setHsv({ s: clamp(s, 0, 1) });
			})}
			{@render field("V", hsv.v, (v) => {
				setHsv({ v: clamp(v, 0, 1) });
			})}
		{:else}
			{@render field("L", lch.l, (l) => {
				setLch({ l: clamp(l, 0, 1) });
			})}
			{@render field("C", lch.c, (c) => {
				setLch({ c: clamp(c, 0, 0.5) });
			})}
			{@render field("H", lch.h, (h) => {
				setLch({ h: clamp(h, 0, 360) });
			})}
		{/if}
		{#if alpha}
			{@render field("A", value.a, (a) => {
				commit({ ...value, a: clamp(a, 0, 1) }, { hsv, lch });
			})}
		{/if}
	</div>

	<div class="flex items-center gap-1.5">
		<span
			class="size-7 shrink-0 rounded-sm ring-1 ring-black/20"
			style:background={linearToCss({ ...value, a: 1 }, gamut())}
		></span>
		<input
			type="text"
			aria-label={gamut() === "srgb" ? "Hex" : "Hex, in Display P3"}
			title={gamut() === "srgb" ? undefined : "In Display P3"}
			spellcheck="false"
			autocomplete="off"
			class="bg-foreground/5 focus:bg-foreground/10 h-7 min-w-0 flex-1 rounded-sm px-2 text-xs uppercase outline-none"
			value={hexFocused ? hexDraft : hex}
			onfocus={() => {
				hexDraft = hex;
				hexFocused = true;
			}}
			oninput={(e) => {
				hexDraft = e.currentTarget.value;
			}}
			onblur={commitHex}
			onkeydown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
			}}
		/>
		{#if EyeDropper}
			<button
				type="button"
				title="Pick a colour from the screen"
				class="hover:bg-foreground/10 flex size-7 shrink-0 items-center justify-center rounded-sm"
				onclick={pickFromScreen}
			>
				<EyedropperIcon />
			</button>
		{/if}
	</div>
</div>
