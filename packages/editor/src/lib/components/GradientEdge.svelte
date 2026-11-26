<script lang="ts">
	import { hidesLinks } from "$core";
	import { type EdgeProps, getBezierPath, ViewportPortal } from "@xyflow/svelte";

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

	/** Links into the inputs the node doesn't show (another variant's or type's) are kept but not drawn. */
	const parked = $derived(graph.hiddenInputs(target, view.path).has(targetHandleId ?? ""));

	/**
	 * What the link does with a texture: a texture linked to a value is
	 * sampled, a value linked to a Texture input rendered first, which a tag
	 * tells; one it can't read is invalid.
	 */
	const textureLink = $derived(
		graph.passAnalysis().link(view.path, {
			id,
			source,
			sourceHandle: sourceHandleId ?? "",
			target,
			targetHandle: targetHandleId ?? "",
		}),
	);

	/**
	 * What the link does with frame values: it carries one (the same for the
	 * whole frame, so it can set sizes and counts), or gives a per-pixel value
	 * to an input that needs one.
	 */
	const frameLink = $derived(
		graph.frameValueAnalysis().link(view.path, {
			id,
			source,
			sourceHandle: sourceHandleId ?? "",
			target,
			targetHandle: targetHandleId ?? "",
		}),
	);

	/** Links breaking zone rules, or reading no texture, are drawn red and ignored by codegen. */
	const invalid = $derived(
		graph.isEdgeInvalid(id) || textureLink?.kind === "invalid" || frameLink?.kind === "invalid",
	);
	const invalidReason = $derived(
		textureLink?.kind === "invalid"
			? textureLink.reason
			: frameLink?.kind === "invalid"
				? frameLink.reason
				: (graph.zoneLinkReason(id) ??
					"Invalid link: it can't leave the zone it starts in"),
	);

	/** Frame values are drawn dotted, apart from the solid links of other values and the dashed ones of hidden links. */
	const frameValue = $derived(frameLink?.kind === "frame");

	/** Textures are drawn thicker. */
	const texture = $derived(sourceType === "texture" || textureLink?.kind === "render");
	let labelHovered = $state(false);
	// Counting the frame's passes walks every group instance, which costs more
	// than the rest of an edit: only a pass tag being pointed at needs it.
	const passes = $derived.by(() =>
		labelHovered && textureLink?.kind === "render"
			? graph.passAnalysis().renders().size + 1
			: 0,
	);
	const conversion = $derived(
		textureLink?.kind === "sample"
			? { label: "sample", title: "Sampled at the pixel: its colour there" }
			: textureLink?.kind === "render"
				? {
						label: "pass",
						title: `Rendered to a texture first, in a pass of its own: the frame draws ${String(passes)} passes`,
					}
				: undefined,
	);

	/** Length of the dashed stubs a hidden link is drawn as, at both its ends. */
	const STUB = 14;
	/** Vertical distance between the tags of hidden links reaching one input. */
	const TAG_STEP = 12;

	/**
	 * Links out of a named reroute are drawn as dashed stubs, the target's
	 * tagged with the reroute's name; in full while hovered or while either
	 * end is selected.
	 */
	const hidden = $derived(hidesLinks(view.document.nodesById.get(source)));
	let hovered = $state(false);
	const revealed = $derived(
		hovered ||
			(selected ?? false) ||
			(view.document.nodesById.get(source)?.selected ?? false) ||
			(view.document.nodesById.get(target)?.selected ?? false),
	);
	/** Hidden links into one (variadic) input fan their tags out around it. */
	const tagOffset = $derived.by(() => {
		if (!hidden) return 0;
		const doc = view.document;
		const siblings = (doc.edgesByTarget.get(target) ?? []).filter(
			(e) => e.targetHandle === targetHandleId && hidesLinks(doc.nodesById.get(e.source)),
		);
		const index = siblings.findIndex((e) => e.id === id);
		return (index - (siblings.length - 1) / 2) * TAG_STEP;
	});
	const tag = $derived(hidden ? graph.nodeLabel(source) : "");

	function selectSource() {
		view.activate();
		graph.apply({ kind: "selectNodes", args: [[source]] });
	}
</script>

{#if !parked && hidden}
	{@const tagY = targetY + tagOffset}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<g
		class="group"
		onpointerenter={() => (hovered = true)}
		onpointerleave={() => (hovered = false)}
	>
		{#if revealed}
			<path
				d={path}
				fill="none"
				stroke="var(--color-{sourceType})"
				stroke-width="1"
				stroke-dasharray="4 4"
				class="pointer-events-none opacity-50"
			/>
		{/if}
		<path
			d="M {sourceX} {sourceY} h {STUB}"
			fill="none"
			stroke="var(--color-{sourceType})"
			stroke-width="1"
			stroke-dasharray="3 2"
		/>
		<path
			d="M {targetX - STUB} {tagY} H {targetX - 4} L {targetX} {targetY}"
			fill="none"
			stroke={invalid ? "var(--color-destructive)" : `var(--color-${targetType})`}
			stroke-width="1"
			stroke-dasharray="3 2"
		/>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<text
			x={targetX - STUB - 3}
			y={tagY}
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
			d="M {targetX - STUB} {tagY} H {targetX - 4} L {targetX} {targetY}"
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
			/>
		{:else}
			<!-- Stroked with the gradient itself: a mask per link made zooming
			     re-rasterize every link's whole bounding box. -->
			<path
				d={path}
				fill="none"
				stroke="url(#edge-gradient-{id})"
				stroke-width={texture ? 2.5 : frameValue ? 2 : 1}
				stroke-dasharray={frameValue ? "0.1 4" : undefined}
				stroke-linecap={frameValue ? "round" : undefined}
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

		{#if conversion && !invalid}
			<g
				transform="translate({midX} {midY})"
				class="link-conversion"
				role="img"
				onpointerenter={() => (labelHovered = true)}
				onpointerleave={() => (labelHovered = false)}
			>
				<title>{conversion.title}</title>
				<rect x="-18" y="-7" width="36" height="14" rx="7" />
				<text text-anchor="middle" dominant-baseline="central">{conversion.label}</text>
			</g>
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
			onpointerenter={() => (hovered = true)}
			onpointerleave={() => (hovered = false)}
		>
			{#if invalid}
				<title>{invalidReason}</title>
			{:else if frameValue}
				<title>The same for the whole frame</title>
			{/if}
		</path>
	</g>
{/if}

<!-- Above the nodes, which links are drawn under: a reason hidden by a node can't be read. -->
{#if invalid && (selected === true || hovered)}
	<ViewportPortal target="front">
		<div
			class="bg-card text-destructive border-destructive pointer-events-none absolute top-0 left-0 w-max max-w-56 rounded-sm border px-1.5 py-0.5 text-[10px] leading-snug shadow-sm"
			style:transform="translate(-50%, -50%) translate({midX}px, {midY}px)"
		>
			{invalidReason}
		</div>
	</ViewportPortal>
{/if}
