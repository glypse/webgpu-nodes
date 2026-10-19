<script lang="ts">
	import { Button, Command } from "$theme";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";
	import { tick } from "svelte";

	import { type AddMenuEntry, groupByHeading } from "./add-menu";

	/** Menu size used to keep it inside the window. */
	const WIDTH = 256;
	const MAX_HEIGHT = 360;
	const MARGIN = 8;

	let {
		open = $bindable(false),
		x,
		y,
		entries,
		placeholder = "Search nodes…",
		onpick,
		ondelete,
	}: {
		open?: boolean;
		/** Where to show the menu, in client (viewport) coordinates. */
		x: number;
		y: number;
		entries: AddMenuEntry[];
		placeholder?: string;
		onpick: (entry: AddMenuEntry) => void;
		ondelete?: (entry: AddMenuEntry) => void;
	} = $props();

	let query = $state("");
	let input = $state<HTMLInputElement | null>(null);
	let panel = $state<HTMLDivElement | null>(null);

	const groups = $derived(groupByHeading(entries));

	const left = $derived(Math.max(MARGIN, Math.min(x, window.innerWidth - WIDTH - MARGIN)));
	const top = $derived(Math.max(MARGIN, Math.min(y, window.innerHeight - MAX_HEIGHT - MARGIN)));

	// Fresh search, focused, every time the menu opens: just start typing.
	$effect(() => {
		if (!open) return;
		query = "";
		void tick().then(() => input?.focus());
	});

	function pick(entry: AddMenuEntry) {
		if (entry.disabled) return;
		open = false;
		onpick(entry);
	}

	function handleWindowPointerDown(event: PointerEvent) {
		if (open && panel && !panel.contains(event.target as Node)) open = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			open = false;
		}
	}
</script>

<svelte:window onpointerdown={handleWindowPointerDown} />

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={panel}
		class="bg-popover fixed z-50 overflow-hidden rounded-xl border shadow-lg"
		style:left="{left}px"
		style:top="{top}px"
		style:width="{WIDTH}px"
		onkeydown={handleKeydown}
		oncontextmenu={(e) => {
			e.preventDefault();
		}}
	>
		<Command.Root>
			<Command.Input bind:ref={input} bind:value={query} {placeholder} />
			<Command.List style="max-height: {MAX_HEIGHT - 48}px">
				<Command.Empty>No matching node.</Command.Empty>
				{#each groups as group (group.heading)}
					<Command.Group heading={group.heading}>
						{#each group.entries as entry (entry.key)}
							<Command.Item
								value={entry.key}
								keywords={[entry.label, entry.heading]}
								disabled={entry.disabled}
								onSelect={() => {
									pick(entry);
								}}
							>
								<span class="truncate">{entry.label}</span>
								{#if entry.deletable && ondelete}
									<Button
										variant="ghost"
										size="icon-sm"
										class="ml-auto"
										title="Delete this unused group"
										onclick={(e: MouseEvent) => {
											e.stopPropagation();
											ondelete(entry);
										}}
									>
										<TrashIcon />
									</Button>
								{/if}
							</Command.Item>
						{/each}
					</Command.Group>
				{/each}
			</Command.List>
		</Command.Root>
	</div>
{/if}
