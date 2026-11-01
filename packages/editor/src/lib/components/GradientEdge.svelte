<script lang="ts">
	import { hidesLinks } from "$core";
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

	/** Length of the stubs a hidden link is drawn as, at both its ends. */
	const STUB = 14;

	/**
	 * Links out of a named reroute are drawn as stubs, the target's tagged
	 * with the reroute's name; in full (dashed) while either end is selected.
	 */
	const hidden = $derived(hidesLinks(view.document.nodesById.get(source)));
	const revealed = $derived(
		(selected ?? false) ||
			(view.document.nodesById.get(source)?.selected ?? false) ||
			(view.document.nodesById.get(target)?.selected ?? false),
	);
	const tag = $derived(hidden ? graph.nodeLabel(source) : "");

	function selectSource() {
		view.activate();
		graph.selectNodes([source]);
	}
</script>

{#if !parked && hidden}
	<g class="group">
		{#if revealed}
			<path
				d={path}
				fill="none"
				stroke="var(--color-{sourceType})"
				stroke-width="1"
				stroke-dasharray="4 4"
				class="opacity-50"
			/>
		{/if}
		<path
			d="M {sourceX} {sourceY} h {STUB}"
			fill="none"
			stroke="var(--color-{sourceType})"
			stroke-width="1"
		/>
		<path
			d="M {targetX - STUB} {targetY} H {targetX}"
			fill="none"
			stroke={invalid ? "var(--color-destructive)" : `var(--color-${targetType})`}
			stroke-width="1"
		/>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<text
			x={targetX - STUB - 3}
			y={targetY}
			text-anchor="end"
			dominant-baseline="central"
			class="link-tag"
			role="button"
			tabindex="-1"
			onclick={selectSource}
		>
			<title>{tag}: click to select the reroute</title>
			{tag}
		</text>
		<path
			{id}
			data-link-path
			d="M {targetX - STUB} {targetY} H {targetX}"
			fill="none"
			stroke="transparent"
			stroke-width="12"
			class={view.locked ? undefined : "cursor-pointer"}
		/>
	</g>
{:else if !parked}
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
			<!-- Stroked with the gradient itself: a mask per link made zooming
			     re-rasterize every link's whole bounding box. -->
			<path
				d={path}
				fill="none"
				stroke="url(#edge-gradient-{id})"
				stroke-width="1"
				class="transition-opacity {selected ? 'opacity-100' : 'opacity-60'}"
			/>
		{/if}

		<!-- Hover overlay -->
		<path
			d={path}
			fill="none"
			stroke="var(--color-foreground)"
			stroke-width="1"
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
			data-link-path
			d={path}
			fill="none"
			stroke="transparent"
			stroke-width="20"
			class={view.locked ? undefined : "cursor-pointer"}
		/>
	</g>
{/if}
