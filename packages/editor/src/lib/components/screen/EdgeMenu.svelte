<script lang="ts">
	import { ContextMenu } from "$theme";
	import ArrowLineDownIcon from "phosphor-svelte/lib/ArrowLineDownIcon";
	import ArrowLineLeftIcon from "phosphor-svelte/lib/ArrowLineLeftIcon";
	import ArrowLineRightIcon from "phosphor-svelte/lib/ArrowLineRightIcon";
	import ArrowLineUpIcon from "phosphor-svelte/lib/ArrowLineUpIcon";
	import ArrowsDownUpIcon from "phosphor-svelte/lib/ArrowsDownUpIcon";
	import ArrowsLeftRightIcon from "phosphor-svelte/lib/ArrowsLeftRightIcon";
	import SquareSplitHorizontalIcon from "phosphor-svelte/lib/SquareSplitHorizontalIcon";
	import SquareSplitVerticalIcon from "phosphor-svelte/lib/SquareSplitVerticalIcon";

	/** The options of an edge between two areas, as Blender's right-click on an edge offers. */
	let {
		trigger = $bindable(null),
		axis,
		canJoinForward,
		canJoinBackward,
		onsplit,
		onjoin,
		onswap,
	}: {
		/** The element the menu is opened from, at a point (see `openContextMenuAt`). */
		trigger?: HTMLElement | null;
		/** "x" for an edge between areas side by side, "y" for one above the other. */
		axis: "x" | "y";
		/** Whether the area before the edge (left or above) can grow over the one after it. */
		canJoinForward: boolean;
		canJoinBackward: boolean;
		onsplit: (axis: "x" | "y") => void;
		/** Join over the edge: `forward` grows the area before it over the one after it. */
		onjoin: (forward: boolean) => void;
		onswap: () => void;
	} = $props();

	const ForwardIcon = $derived(axis === "x" ? ArrowLineRightIcon : ArrowLineDownIcon);
	const BackwardIcon = $derived(axis === "x" ? ArrowLineLeftIcon : ArrowLineUpIcon);
	const SwapIcon = $derived(axis === "x" ? ArrowsLeftRightIcon : ArrowsDownUpIcon);
</script>

<ContextMenu.Root>
	<!-- Out of the pointer's way: only opened from code, never by a right-click. -->
	<ContextMenu.Trigger bind:ref={trigger} class="absolute inset-0" style="pointer-events: none" />
	<ContextMenu.Content class="w-52">
		<ContextMenu.Label class="text-muted-foreground">Area edge options</ContextMenu.Label>
		<ContextMenu.Separator />
		<ContextMenu.Item onSelect={() => onsplit("x")}>
			<SquareSplitHorizontalIcon />
			Vertical split
		</ContextMenu.Item>
		<ContextMenu.Item onSelect={() => onsplit("y")}>
			<SquareSplitVerticalIcon />
			Horizontal split
		</ContextMenu.Item>
		<ContextMenu.Separator />
		<ContextMenu.Item disabled={!canJoinForward} onSelect={() => onjoin(true)}>
			<ForwardIcon />
			{axis === "x" ? "Join right" : "Join down"}
		</ContextMenu.Item>
		<ContextMenu.Item disabled={!canJoinBackward} onSelect={() => onjoin(false)}>
			<BackwardIcon />
			{axis === "x" ? "Join left" : "Join up"}
		</ContextMenu.Item>
		<ContextMenu.Separator />
		<ContextMenu.Item onSelect={onswap}>
			<SwapIcon />
			Swap areas
		</ContextMenu.Item>
	</ContextMenu.Content>
</ContextMenu.Root>
