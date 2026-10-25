<script lang="ts">
	import {
		type ColorComponents,
		type ColorMode,
		enumValue,
		type InputValue,
		type NodeData,
		type NodeInputDef,
		type NodeWidget,
		readComponent,
	} from "$core";
	import { ColorWheels } from "$theme";

	import { getGraphManager } from "../../graph-manager.svelte";

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

	const valueOf = (input: string) => data.values?.[input] ?? defaults?.[input];
	const binding = $derived.by(() => {
		const control = inputs.find((i) => i.id === widget.mode)?.control;
		const variants = control?.kind === "enum" ? control.variants : [];
		return widget.modes[String(enumValue(valueOf(widget.mode), variants))];
	});
	const mode = $derived<ColorMode>(binding?.space ?? "rgb");
	/** The inputs holding the mode's components. */
	const componentInputs = $derived(binding?.components ?? ["", "", ""]);
	const components = $derived(
		componentInputs.map((c) => readComponent(valueOf(c), "_")) as unknown as ColorComponents,
	);
	const locked = $derived(componentInputs.map((c) => connected.has(c)));

	function write(next: ColorComponents) {
		const values = { ...data.values };
		componentInputs.forEach((c, i) => {
			if (!connected.has(c)) values[c] = next[i] ?? 0;
		});
		graph.updateNodeData(id, { values }, { retype: false });
	}
</script>

<ColorWheels
	class="nodrag nowheel py-1"
	wheelClass="min-w-0 flex-1"
	{mode}
	{components}
	{locked}
	{disabled}
	onchange={write}
/>
