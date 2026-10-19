<script lang="ts">
	import { getBezierPath, type EdgeProps } from "@xyflow/svelte";

	import { getGraphManager } from "./graph-state.svelte";

	let {
		id,
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
		source,
		target,
		sourceHandleId,
		targetHandleId,
		selected,
	}: EdgeProps = $props();

	const PADDING = 24;

	const graph = getGraphManager();

	const [path] = $derived(
		getBezierPath({
			sourceX,
			sourceY,
			targetX,
			targetY,
			sourcePosition,
			targetPosition,
		}),
	);

	const sourceType = $derived(graph.resolveOutputHandleType(source, sourceHandleId ?? ""));

	const targetType = $derived.by(() => {
		const node = graph.resolveNode(target);
		if (!node) return "f32";
		return graph.resolveInputType(target, targetHandleId ?? "");
	});

	/** Links breaking zone rules are drawn red and ignored by codegen. */
	const invalid = $derived(graph.isEdgeInvalid(id));

	const bounds = $derived({
		x: Math.min(sourceX, targetX) - PADDING,
		y: Math.min(sourceY, targetY) - PADDING,
		w: Math.abs(targetX - sourceX) + PADDING * 2,
		h: Math.abs(targetY - sourceY) + PADDING * 2,
	});
</script>

<defs>
	<linearGradient
		id="edge-gradient-{id}"
		gradientUnits="userSpaceOnUse"
		x1={sourceX}
		y1={sourceY}
		x2={targetX}
		y2={targetY}
	>
		<stop offset="0%" style="stop-color: var(--color-{sourceType})" />
		<stop offset="100%" style="stop-color: var(--color-{targetType})" />
	</linearGradient>

	<mask id="edge-mask-{id}" maskContentUnits="userSpaceOnUse">
		<path d={path} fill="none" stroke="white" stroke-width="1" />
	</mask>
</defs>

<g class="group">
	{#if invalid}
		<!-- Invalid link (leaves a zone, or merges unrelated zones) -->
		<path
			d={path}
			fill="none"
			stroke="var(--color-destructive)"
			stroke-width="1.5"
			stroke-dasharray="6 4"
			class="transition-opacity {selected ? 'opacity-100' : 'opacity-80'}"
		>
			<title>Invalid link: it can't leave the zone it starts in</title>
		</path>
	{:else}
		<!-- Gradient stroke -->
		<rect
			x={bounds.x}
			y={bounds.y}
			width={bounds.w}
			height={bounds.h}
			fill="url(#edge-gradient-{id})"
			mask="url(#edge-mask-{id})"
			class="transition-opacity {selected ? 'opacity-100' : 'opacity-60'}"
		/>
	{/if}

	<!-- Hover overlay -->
	<rect
		x={bounds.x}
		y={bounds.y}
		width={bounds.w}
		height={bounds.h}
		fill="var(--color-foreground)"
		mask="url(#edge-mask-{id})"
		class="opacity-0 transition-opacity group-hover:opacity-40"
	/>

	<!-- Invisible interaction path for click/hover detection -->
	<path {id} d={path} fill="none" stroke="transparent" stroke-width="20" class="cursor-pointer" />
</g>
