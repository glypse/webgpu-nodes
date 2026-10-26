<script lang="ts">
	import { type CustomSockets, type SocketSide, WGSL_TYPES, type WgslType } from "$core";
	import { Button, Input } from "$theme";
	import ArrowDownIcon from "phosphor-svelte/lib/ArrowDownIcon";
	import ArrowUpIcon from "phosphor-svelte/lib/ArrowUpIcon";
	import PlusIcon from "phosphor-svelte/lib/PlusIcon";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";

	import { getGraphManager } from "../../graph-manager.svelte";
	import TypePicker from "../TypePicker.svelte";

	let { id, sockets, disabled }: { id: string; sockets: CustomSockets; disabled: boolean } =
		$props();

	const graph = getGraphManager();

	const SIDES: { side: SocketSide; label: string; hint: string }[] = [
		{ side: "inputs", label: "Inputs", hint: "Read by the code as parameters." },
		{
			side: "outputs",
			label: "Outputs",
			hint: "Variables the code sets; zero unless it does.",
		},
	];

	// Names being typed, committed on blur so a half-typed name isn't rejected.
	let drafts = $state<Record<string, string>>({});
	let rejected = $state<string | null>(null);

	function commit(side: SocketSide, socketId: string) {
		const draft = drafts[socketId];
		if (draft === undefined) return;
		drafts = Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== socketId));
		rejected = graph.renameCustomSocket(id, side, socketId, draft) ? null : socketId;
	}

	function blurOnEnter(e: KeyboardEvent) {
		if (e.key === "Enter") (e.target as HTMLInputElement).blur();
	}
</script>

<div class="flex flex-col gap-4">
	{#each SIDES as { side, label, hint } (side)}
		{@const list = sockets[side]}
		<div class="flex flex-col gap-1.5">
			<div class="flex items-center justify-between">
				<div class="flex flex-col">
					<span class="text-sm font-medium">{label}</span>
					<span class="text-muted-foreground text-xs">{hint}</span>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					title="Add {side === 'inputs' ? 'an input' : 'an output'}"
					{disabled}
					onclick={() => graph.addCustomSocket(id, side, "f32")}
				>
					<PlusIcon />
				</Button>
			</div>
			{#each list as socket, i (socket.id)}
				<div class="flex items-center gap-1">
					<Input
						class={["h-8 text-xs", rejected === socket.id && "ring-destructive ring-1"]}
						aria-label="Name"
						value={drafts[socket.id] ?? socket.label}
						{disabled}
						oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
							drafts[socket.id] = e.currentTarget.value;
						}}
						onblur={() => commit(side, socket.id)}
						onkeydown={blurOnEnter}
					/>
					<TypePicker
						types={WGSL_TYPES}
						value={socket.type}
						{disabled}
						class="w-24 shrink-0"
						title="Socket type"
						onpick={(type: WgslType) =>
							graph.setCustomSocketType(id, side, socket.id, type)}
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						title="Move up"
						disabled={disabled || i === 0}
						onclick={() => graph.moveCustomSocket(id, side, socket.id, -1)}
					>
						<ArrowUpIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						title="Move down"
						disabled={disabled || i === list.length - 1}
						onclick={() => graph.moveCustomSocket(id, side, socket.id, 1)}
					>
						<ArrowDownIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						title="Remove"
						{disabled}
						onclick={() => graph.removeCustomSocket(id, side, socket.id)}
					>
						<TrashIcon />
					</Button>
				</div>
			{/each}
		</div>
	{/each}
	{#if rejected}
		<p class="text-destructive text-xs">
			A name must be a WGSL identifier (letters, digits and _, not starting with a digit or
			__), not a keyword or type, and not taken by another socket.
		</p>
	{/if}
</div>
