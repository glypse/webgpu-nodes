<script lang="ts">
	import CaretLeftIcon from "phosphor-svelte/lib/CaretLeftIcon";
	import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
	import { tick } from "svelte";
	import { type HTMLInputAttributes } from "svelte/elements";
	import { on } from "svelte/events";

	import { cn, type WithElementRef } from "../../../utils.js";

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, "type" | "value"> & {
			value?: number;
			label?: string;
			readonly?: boolean;
			/** Restrict the value to whole numbers (step 1, no decimals shown). */
			integer?: boolean;
			/** Lowest accepted value. */
			min?: number;
			/** Highest accepted value. */
			max?: number;
		}
	>;

	let {
		ref = $bindable(null),
		value = $bindable(0),
		class: className,
		"data-slot": dataSlot = "scrubbable",
		label,
		readonly = false,
		integer = false,
		min,
		max,
		...restProps
	}: Props = $props();

	const DRAG_THRESHOLD = 3;

	let pendingScrub = $state(false);
	let scrubbing = $state(false);
	let scrubStartX = $state(0);
	let scrubStartValue = $state(0);
	let lockedMovementX = $state(0);
	let localDisplay = $state(formatValue(0));
	let isFocused = $state(false);
	let pointerLocked = $state(false);
	let cleanupScrubMove: (() => void) | null = null;
	let cleanupScrubEnd: (() => void) | null = null;

	function getStep(event: MouseEvent | KeyboardEvent): number {
		if (integer) return 1;
		return event.shiftKey ? 0.01 : 0.1;
	}

	function formatValue(n: number): string {
		return integer ? String(Math.round(n)) : n.toFixed(3);
	}

	/** Apply the integer / range constraints to a candidate value. */
	function constrain(n: number): number {
		const stepped = integer ? Math.round(n) : n;
		const above = min === undefined ? stepped : Math.max(min, stepped);
		return max === undefined ? above : Math.min(max, above);
	}

	function setValue(n: number): void {
		value = constrain(n);
	}

	function commitValue(raw: string): void {
		const parsed = parseFloat(raw);
		setValue(Number.isNaN(parsed) ? 0 : parsed);
		localDisplay = formatValue(value);
	}

	async function emitInput(): Promise<void> {
		await tick();
		ref?.dispatchEvent(new Event("input", { bubbles: true }));
	}

	async function handleScrubStart(event: MouseEvent): Promise<void> {
		event.stopPropagation();
		if (isFocused) return;
		pendingScrub = true;
		scrubStartX = event.clientX;
		scrubStartValue = value;
		lockedMovementX = 0;

		await ref?.requestPointerLock();
		cleanupScrubMove = on(document, "mousemove", handleScrubMove);
		cleanupScrubEnd = on(document, "mouseup", handleScrubEnd);
	}

	function handleScrubMove(event: MouseEvent): void {
		if (pendingScrub && !scrubbing) {
			if (pointerLocked) {
				pendingScrub = false;
				scrubbing = true;
				(event.target as HTMLInputElement).blur();
			} else {
				const dx = Math.abs(event.clientX - scrubStartX);
				if (dx > DRAG_THRESHOLD) {
					pendingScrub = false;
					scrubbing = true;
					(event.target as HTMLInputElement).blur();
				} else {
					return;
				}
			}
		}
		if (!scrubbing) return;

		if (pointerLocked) {
			lockedMovementX += event.movementX;
			const step = getStep(event);
			const increment =
				Math.sign(lockedMovementX) * step * Math.ceil(Math.abs(lockedMovementX) / 2);
			setValue(scrubStartValue + increment);
		} else {
			const dx = event.clientX - scrubStartX;
			const step = getStep(event);
			const increment = Math.sign(dx) * step * Math.ceil(Math.abs(dx) / 2);
			setValue(scrubStartValue + increment);
		}
		void emitInput();
	}

	function handleScrubEnd(): void {
		pendingScrub = false;
		scrubbing = false;
		lockedMovementX = 0;

		if (pointerLocked) {
			document.exitPointerLock();
		}

		cleanupScrubMove?.();
		cleanupScrubEnd?.();
		cleanupScrubMove = null;
		cleanupScrubEnd = null;
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Enter") {
			event.preventDefault();
			(event.target as HTMLInputElement).blur();
			return;
		}
		const step = getStep(event);
		if (event.key === "ArrowRight" || event.key === "ArrowUp") {
			event.preventDefault();
			setValue(value + step);
			void emitInput();
		} else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
			event.preventDefault();
			setValue(value - step);
			void emitInput();
		}
	}

	function handleDecrement(event: MouseEvent): void {
		event.stopPropagation();
		const step = getStep(event);
		setValue(value - step);
		void emitInput();
	}

	function handleIncrement(event: MouseEvent): void {
		event.stopPropagation();
		const step = getStep(event);
		setValue(value + step);
		void emitInput();
	}

	function handleClick(event: MouseEvent): void {
		event.stopPropagation();
	}

	function handleInput(event: Event): void {
		const target = event.target as HTMLInputElement;
		const parsed = parseFloat(target.value);
		if (!Number.isNaN(parsed)) {
			setValue(parsed);
		}
	}

	function handleFocus(): void {
		isFocused = true;
	}

	function handleBlur(event: FocusEvent): void {
		isFocused = false;
		commitValue((event.target as HTMLInputElement).value);
	}

	$effect(() => {
		if (!isFocused) {
			localDisplay = formatValue(value);
		}
	});

	$effect(() => {
		const cleanup = on(document, "pointerlockchange", () => {
			pointerLocked = document.pointerLockElement === ref;
		});
		return cleanup;
	});
</script>

{#snippet sideButton(side: "left" | "right")}
	{@const isRight = side === "right"}
	<button
		type="button"
		class="absolute {isRight
			? 'right-0'
			: 'left-0'} hover:bg-foreground/10 z-10 flex h-full w-6 items-center justify-center bg-transparent p-0 text-xs opacity-0 transition-opacity group-hover/scrub:opacity-50 hover:opacity-100!"
		tabindex="-1"
		aria-label={isRight ? "Increase value" : "Decrease value"}
		onmousedown={isRight ? handleIncrement : handleDecrement}
	>
		{#if isRight}
			<CaretRightIcon />
		{:else}
			<CaretLeftIcon />
		{/if}
	</button>
{/snippet}

{#if label}
	<span class="text-muted-foreground pointer-events-none shrink-0 pr-1 text-xs">{label}</span>
{/if}
<div
	class={cn(
		"group/scrub relative flex grow items-center overflow-clip rounded-sm transition-colors",
		!readonly && "hover:bg-foreground/5 nodrag nokey",
		className,
	)}
	data-slot={dataSlot}
>
	{#if !readonly}
		{@render sideButton("left")}
	{/if}

	<input
		bind:this={ref}
		type="number"
		class="bg-foreground/5 h-8 w-full min-w-0 px-2.5 py-1 text-center transition-colors outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none {scrubbing ||
		isFocused
			? 'bg-foreground/10'
			: ''} {scrubbing ? 'cursor-none' : ''} {readonly ? 'opacity-50' : ''}"
		inputmode={integer ? "numeric" : "decimal"}
		aria-label="Numeric value"
		aria-valuenow={value}
		aria-valuetext={formatValue(value)}
		value={localDisplay}
		readonly={readonly || undefined}
		oninput={!readonly ? handleInput : undefined}
		onfocus={!readonly ? handleFocus : undefined}
		onblur={!readonly ? handleBlur : undefined}
		onmousedown={!readonly ? handleScrubStart : undefined}
		onkeydown={!readonly ? handleKeydown : undefined}
		onclick={handleClick}
		{...restProps}
	/>

	{#if !readonly}
		{@render sideButton("right")}
	{/if}
</div>
