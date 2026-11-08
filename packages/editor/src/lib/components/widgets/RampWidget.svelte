<script lang="ts">
	import {
		colorRampStops,
		enumValue,
		type InputValue,
		type NodeData,
		RAMP_HUE,
		RAMP_HUES,
		RAMP_INTERPOLATION,
		RAMP_INTERPOLATIONS,
		RAMP_SPACE,
		RAMP_SPACES,
		type RampModes,
		type RampStop,
		readComponent,
		type Rgba,
	} from "$core";
	import { RampEditor } from "$theme";

	import { getDocumentView } from "../../document-view";
	import { getGraphManager } from "../../graph-manager.svelte";

	let {
		id,
		data,
		defaults,
		connected,
		disabled,
	}: {
		id: string;
		data: NodeData;
		/** Values the node's inputs have until edited. */
		defaults: Readonly<Record<string, InputValue>> | undefined;
		/** Ids of the node's linked inputs. */
		connected: ReadonlySet<string | null>;
		disabled: boolean;
	} = $props();

	const graph = getGraphManager();
	const view = getDocumentView();

	/** What a linked stop is drawn as: its colour is only known in the shader. */
	const UNKNOWN: Rgba = { r: 0.214, g: 0.214, b: 0.214, a: 1 };

	const valueOf = (input: string) => data.values?.[input] ?? defaults?.[input];
	const stops = $derived(colorRampStops(data));
	const linked = $derived(new Set(stops.filter((s) => connected.has(s.id)).map((s) => s.id)));
	const colors = $derived(
		Object.fromEntries(
			stops.map((s): [string, Rgba] => {
				if (linked.has(s.id)) return [s.id, UNKNOWN];
				const value = valueOf(s.id);
				return [
					s.id,
					{
						r: readComponent(value, "x"),
						g: readComponent(value, "y"),
						b: readComponent(value, "z"),
						a: typeof value === "object" ? readComponent(value, "w") : 1,
					},
				];
			}),
		),
	);
	// Linked enums are drawn as last picked on the node.
	const modes = $derived<RampModes>({
		interpolation: enumValue(valueOf(RAMP_INTERPOLATION), RAMP_INTERPOLATIONS) ?? 0,
		space: enumValue(valueOf(RAMP_SPACE), RAMP_SPACES) ?? 0,
		hue: enumValue(valueOf(RAMP_HUE), RAMP_HUES) ?? 0,
	});
	const alpha = $derived(
		graph.resolveNodeOutputs(id, view.path).find((o) => o.id === "color")?.type === "vec4f",
	);

	function change(next: RampStop[], added: Record<string, Rgba>) {
		const values = Object.fromEntries(
			Object.entries(added).map(([stop, { r, g, b, a }]) => [
				stop,
				{ x: r, y: g, z: b, w: a },
			]),
		);
		graph.setColorRamp(id, next, values);
	}
</script>

<RampEditor class="py-1" {stops} {colors} {linked} {modes} {alpha} {disabled} onchange={change} />
