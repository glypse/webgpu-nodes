<script lang="ts">
	import { Dialog } from "$theme";

	import { getGraphManager } from "../../graph-manager.svelte";
	import AppearanceSettings from "./AppearanceSettings.svelte";
	import CanvasSettings from "./CanvasSettings.svelte";
	import ColorSettings from "./ColorSettings.svelte";
	import { SETTINGS_GROUPS } from "./pages";
	import TimeSettings from "./TimeSettings.svelte";

	const graph = getGraphManager();

	const PAGES = {
		canvas: CanvasSettings,
		time: TimeSettings,
		color: ColorSettings,
		appearance: AppearanceSettings,
	};

	const page = $derived(
		SETTINGS_GROUPS.flatMap((g) => g.pages).find((p) => p.id === graph.settingsPage),
	);
</script>

<Dialog.Root
	open={graph.settingsPage !== null}
	onOpenChange={(open: boolean) => {
		if (!open) graph.settingsPage = null;
	}}
>
	<Dialog.Content
		class="h-[min(36rem,85dvh)] gap-0 bg-transparent p-0 ring-0 sm:max-w-3xl"
		showCloseButton
	>
		<div
			class="bg-card text-card-foreground ring-foreground/10 flex size-full flex-col overflow-hidden rounded-xl text-sm ring-1 sm:flex-row"
		>
			<nav
				class="bg-muted/40 flex shrink-0 gap-4 overflow-x-auto border-b p-3 sm:w-52 sm:flex-col sm:border-r sm:border-b-0"
			>
				<Dialog.Title class="hidden px-2 pt-1 text-base font-semibold sm:block">
					Settings
				</Dialog.Title>
				{#each SETTINGS_GROUPS as group (group.label)}
					<div class="flex shrink-0 flex-col gap-0.5">
						<span class="text-muted-foreground px-2 pb-1 text-xs font-medium">
							{group.label}
						</span>
						<div class="flex gap-0.5 sm:flex-col">
							{#each group.pages as item (item.id)}
								<button
									type="button"
									class={[
										"hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
										item.id === graph.settingsPage &&
											"bg-muted text-foreground font-medium",
									]}
									aria-current={item.id === graph.settingsPage
										? "page"
										: undefined}
									onclick={() => {
										graph.settingsPage = item.id;
									}}
								>
									<item.icon class="text-muted-foreground size-4" />
									{item.label}
								</button>
							{/each}
						</div>
						<span
							class="text-muted-foreground/70 hidden px-2 pt-1 text-[11px] sm:block"
						>
							{group.hint}
						</span>
					</div>
				{/each}
			</nav>
			{#if page}
				{@const Page = PAGES[page.id]}
				<div class="flex min-h-0 min-w-0 flex-1 flex-col">
					<div class="grid auto-rows-min items-start gap-1 border-b py-4 pr-12 pl-4">
						<div class="text-base leading-snug font-medium">{page.label}</div>
						<Dialog.Description class="text-muted-foreground text-sm">
							{page.description}
						</Dialog.Description>
					</div>
					<div class="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-5">
						<Page />
					</div>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
