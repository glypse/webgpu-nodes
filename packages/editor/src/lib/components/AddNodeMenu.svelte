<script lang="ts">
	import {
		type AddMenuEntry,
		type MenuSection,
		groupByHeading,
		groupResults,
		searchEntries,
	} from "$core";
	import { Button, ContextMenu } from "$theme";
	import TrashIcon from "phosphor-svelte/lib/TrashIcon";

	let {
		open = $bindable(false),
		trigger = $bindable(null),
		entries,
		disabled = false,
		placeholder = "Search…",
		onpick,
		ondelete,
	}: {
		open?: boolean;
		/** The element the menu is opened from, at a point (see `openContextMenuAt`). */
		trigger?: HTMLElement | null;
		entries: AddMenuEntry[];
		/** Prevent the menu from opening (e.g. in a locked group). */
		disabled?: boolean;
		placeholder?: string;
		onpick: (entry: AddMenuEntry) => void;
		ondelete?: (entry: AddMenuEntry) => void;
	} = $props();

	let search = $state<HTMLInputElement | null>(null);
	let query = $state("");

	const groups = $derived(groupByHeading(entries));
	const results = $derived(searchEntries(entries, query));
	const resultGroups = $derived(groupResults(results));
	const searching = $derived(query.trim() !== "");

	$effect(() => {
		if (open) query = "";
	});

	function pick(entry: AddMenuEntry) {
		if (entry.disabled) return;
		open = false;
		onpick(entry);
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			const first = resultGroups
				.flatMap((g) => g.results)
				.find(({ entry }) => !entry.disabled);
			if (first) pick(first.entry);
			return;
		}
		// Arrows and Escape go to the menu (navigation, closing); everything
		// else is typing, which the menu's typeahead must not steal.
		if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(event.key)) {
			event.stopPropagation();
		}
	}
</script>

{#snippet sectionMenu(section: MenuSection)}
	<ContextMenu.Sub>
		<ContextMenu.SubTrigger>{section.name}</ContextMenu.SubTrigger>
		<ContextMenu.SubContent class="max-h-96 overflow-y-auto">
			{@render sectionItems(section.entries, section.sections)}
		</ContextMenu.SubContent>
	</ContextMenu.Sub>
{/snippet}

{#snippet sectionItems(sectionEntries: AddMenuEntry[], sections: MenuSection[])}
	{#each sectionEntries as entry (entry.key)}
		{@render entryItem(entry, false)}
	{/each}
	{#if sectionEntries.length > 0 && sections.length > 0}
		<ContextMenu.Separator />
	{/if}
	{#each sections as section (section.name)}
		{@render sectionMenu(section)}
	{/each}
{/snippet}

{#snippet entryItem(entry: AddMenuEntry, withHeading: boolean, alias?: string)}
	<ContextMenu.Item
		disabled={entry.disabled}
		onSelect={() => {
			pick(entry);
		}}
	>
		<span class={withHeading ? "shrink-0" : "truncate"}>
			{entry.label}
			{#if alias}<span class="text-muted-foreground">({alias})</span>{/if}
		</span>
		{#if withHeading}
			<span class="text-muted-foreground ml-auto min-w-0 truncate pl-2 text-xs">
				{[entry.heading, ...(entry.section ?? [])].join(" › ")}
			</span>
		{/if}
		{#if entry.deletable && ondelete}
			<Button
				variant="ghost"
				size="icon-sm"
				class={withHeading ? "" : "ml-auto"}
				title="Delete this unused group"
				onclick={(e: MouseEvent) => {
					e.stopPropagation();
					ondelete(entry);
				}}
			>
				<TrashIcon />
			</Button>
		{/if}
	</ContextMenu.Item>
{/snippet}

<ContextMenu.Root bind:open>
	<!-- Out of the pointer's way: only opened from code, never by a right-click. -->
	<ContextMenu.Trigger
		bind:ref={trigger}
		{disabled}
		class="absolute inset-0"
		style="pointer-events: none"
	/>

	<ContextMenu.Content
		class={searching ? "w-72" : "w-56"}
		onOpenAutoFocus={(e: Event) => {
			e.preventDefault();
			search?.focus();
		}}
	>
		<!-- A plain field, sized like the menu's items. -->
		<input
			bind:this={search}
			bind:value={query}
			{placeholder}
			type="search"
			autocomplete="off"
			spellcheck="false"
			class="placeholder:text-muted-foreground w-full rounded-md bg-transparent px-1.5 py-1 text-sm outline-hidden [&::-webkit-search-cancel-button]:hidden"
			onkeydown={handleSearchKeydown}
		/>
		<ContextMenu.Separator />
		{#if searching}
			<div class="max-h-80 overflow-y-auto">
				{#each resultGroups as group (group.section ?? "")}
					{#if group.section}
						<ContextMenu.Separator />
						<ContextMenu.Label>{group.section}</ContextMenu.Label>
					{/if}
					{#each group.results as { entry, alias } (entry.key)}
						{@render entryItem(entry, true, alias)}
					{/each}
				{:else}
					<div class="text-muted-foreground px-2 py-1.5 text-sm">No matching node.</div>
				{/each}
			</div>
		{:else if groups.length === 0}
			<div class="text-muted-foreground px-2 py-1.5 text-sm">Nothing fits here.</div>
		{:else}
			{#each groups as group (group.heading)}
				<ContextMenu.Sub>
					<ContextMenu.SubTrigger>{group.heading}</ContextMenu.SubTrigger>
					<ContextMenu.SubContent class="max-h-96 overflow-y-auto">
						{@render sectionItems(group.entries, group.sections)}
					</ContextMenu.SubContent>
				</ContextMenu.Sub>
			{/each}
		{/if}
	</ContextMenu.Content>
</ContextMenu.Root>
