<script lang="ts">
	import { getBezierPath, type EdgeProps } from "@xyflow/svelte";

	import { getDocumentView } from "../document-view";
	import { bezierMidpointAngle } from "../geometry/edge-geometry";
	import { getGraphManager } from "../graph-manager.svelte";

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
	const view = getDocumentView();

	const [path, midX, midY] = $derived(
		getBezierPath({
			sourceX,
			sourceY,
			targetX,
			targetY,
			sourcePosition,
			targetPosition,
		}),
	);

	const sourceType = $derived(
		graph.resolveOutputHandleType(source, sourceHandleId ?? "", view.path),
	);

	const targetType = $derived.by(() => {
		const node = graph.resolveNode(target);
		if (!node) return "f32";
		return graph.resolveInputType(target, targetHandleId ?? "", view.path);
	});

	/** Links between two reroutes get a direction arrow at their middle. */
	const arrowAngle = $derived.by(() => {
		const between =
			graph.resolveNode(source)?.type === "reroute" &&
			graph.resolveNode(target)?.type === "reroute";
		return between ? bezierMidpointAngle(sourceX, sourceY, targetX, targetY) : null;
	});

	/** Links into the inputs of a variant the node isn't on are kept but not drawn. */
	const parked = $derived(graph.hiddenInputs(target).has(targetHandleId ?? ""));

	/** Links breaking zone rules are drawn red and ignored by codegen. */
	const invalid = $derived(graph.isEdgeInvalid(id));

	const bounds = $derived({
		x: Math.min(sourceX, targetX) - PADDING,
		y: Math.min(sourceY, targetY) - PADDING,
		w: Math.abs(targetX - sourceX) + PADDING * 2,
		h: Math.abs(targetY - sourceY) + PADDING * 2,
	});
</script>

{#if !parked}
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

		{#if arrowAngle !== null && !invalid}
			<path
				d="M -4 -4.5 L 5 0 L -4 4.5 Z"
				transform="translate({midX} {midY}) rotate({arrowAngle})"
				fill="var(--color-{sourceType})"
				class="pointer-events-none transition-opacity {selected
					? 'opacity-100'
					: 'opacity-80'}"
			/>
		{/if}

		<!-- Invisible interaction path for click/hover detection -->
		<path
			{id}
			d={path}
			fill="none"
			stroke="transparent"
			stroke-width="20"
			class={view.locked ? undefined : "cursor-pointer"}
		/>
	</g>
{/if}
