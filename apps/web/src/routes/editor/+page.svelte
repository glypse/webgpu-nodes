<script lang="ts">
	import {
		Editor,
		GraphManager,
		setDevContext,
		setGraphManager,
		type GraphDocument,
	} from "$editor";
	import { Menubar, AlertDialog } from "$theme";
	import { toggleMode } from "mode-watcher";

	const graph = new GraphManager();
	setGraphManager(graph);

	setDevContext(true); // TODO: Replace with `dev` from `$app/env` past 1.0 release

	function pickFiles(opts: { accept: string; multiple?: boolean }): Promise<File[]> {
		return new Promise((resolve) => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = opts.accept;
			if (opts.multiple) input.multiple = true;
			input.onchange = () => resolve(Array.from(input.files ?? []));
			input.click();
		});
	}

	async function handleUpload() {
		const [file] = await pickFiles({ accept: ".json" });
		if (file) await graph.upload(file);
	}

	function handleExportGroup() {
		const ref = graph.selectedGroupRef;
		if (!ref) return;
		graph.exportGroup(ref);
	}

	/** The id of the first selected, enterable group node, if any. */
	function getSelectedGroupNodeId(): string | undefined {
		for (const id of graph.selectedNodeIds) {
			const node = graph.activeDocument.nodes.find((n) => n.id === id);
			if (node?.type === "node-group" && node.group) return id;
		}
		return undefined;
	}

	function handleGroupSelected() {
		const ids = new Set(graph.selectedNodeIds);
		if (ids.size === 0) return;
		graph.groupSelection(ids);
	}

	function handleUngroupSelected() {
		const ids = new Set(graph.selectedNodeIds);
		if (ids.size === 0) return;
		graph.ungroupSelection(ids);
	}

	let pruneDialogOpen = $state(false);

	function openPruneDialog() {
		pruneDialogOpen = true;
	}

	function confirmPruneUnused() {
		graph.pruneUnusedDefinitions();
		pruneDialogOpen = false;
	}

	function handleEnterGroup() {
		const id = getSelectedGroupNodeId();
		if (id) graph.enterGroup(id);
	}

	function handleExitGroup() {
		graph.exitGroup();
	}

	function handleToggleGroupSheet() {
		const id = getSelectedGroupNodeId();
		if (id) {
			graph.openGroupSheet(id);
		} else if (graph.path.length > 0) {
			const top = graph.path[graph.path.length - 1];
			if (top) graph.openGroupSheet(top);
		} else {
			graph.sheetOpen = !graph.sheetOpen;
		}
	}

	const hasSelection = $derived(graph.selectedNodeIds.length > 0);
	const hasSelectedGroup = $derived(getSelectedGroupNodeId() !== undefined);
	const canExitGroup = $derived(graph.path.length > 0);
	const prunableGroups = $derived(graph.getPrunableGroups());
	const hasPrunable = $derived(prunableGroups.length > 0);

	async function handleImportGroups() {
		const files = await pickFiles({ accept: ".json", multiple: true });
		if (files.length === 0) return;
		const entries = await Promise.all(
			files.map(
				async (file) =>
					JSON.parse(await file.text()) as {
						id?: string;
						name?: string;
						category?: string;
						dependencies?: string[];
						definition?: GraphDocument;
					},
			),
		);
		const result = graph.importGroups(entries);
		if (result.missing.length > 0) {
			console.warn("Import completed with missing dependencies:", result.missing);
		}
	}

	function handleBeforeUnload(event: BeforeUnloadEvent) {
		if (graph.hasUnsavedChanges()) event.preventDefault();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "m" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			toggleMode();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} onbeforeunload={handleBeforeUnload} />

<div class="flex h-dvh w-full flex-col overflow-hidden">
	<Menubar.Root class="h-auto gap-1 rounded-none border-t-0 border-r-0 border-l-0 p-2">
		<Menubar.Menu>
			<Menubar.Trigger>File</Menubar.Trigger>
			<Menubar.Content>
				<Menubar.Item
					onSelect={() => {
						graph.save();
					}}
				>
					Save
				</Menubar.Item>
				<Menubar.Item onSelect={handleUpload}>Upload</Menubar.Item>
				<Menubar.Separator />
				<Menubar.Item onSelect={handleExportGroup} disabled={!graph.selectedGroupRef}>
					Export selected group
				</Menubar.Item>
				<Menubar.Item onSelect={handleImportGroups}>Import groups</Menubar.Item>
			</Menubar.Content>
		</Menubar.Menu>

		<Menubar.Menu>
			<Menubar.Trigger>Edit</Menubar.Trigger>
			<Menubar.Content>
				<Menubar.Item
					onSelect={handleGroupSelected}
					disabled={!(hasSelection && !graph.isLocked)}
				>
					Group selected
					<Menubar.Shortcut>G</Menubar.Shortcut>
				</Menubar.Item>
				<Menubar.Item
					onSelect={handleUngroupSelected}
					disabled={!(hasSelectedGroup && !graph.isLocked)}
				>
					Ungroup selected
					<Menubar.Shortcut>⇧G</Menubar.Shortcut>
				</Menubar.Item>
				<Menubar.Separator />
				<Menubar.Item onSelect={openPruneDialog} disabled={!hasPrunable}>
					Remove all unused group references
				</Menubar.Item>
				<Menubar.Separator />
				<Menubar.Item onSelect={handleEnterGroup} disabled={!hasSelectedGroup}>
					Enter node group
					<Menubar.Shortcut>↵</Menubar.Shortcut>
				</Menubar.Item>
				<Menubar.Item onSelect={handleExitGroup} disabled={!canExitGroup}>
					Exit node group
					<Menubar.Shortcut>Esc</Menubar.Shortcut>
				</Menubar.Item>
				<Menubar.Separator />
				<Menubar.Item
					onSelect={handleToggleGroupSheet}
					disabled={!(hasSelectedGroup || canExitGroup || graph.sheetOpen)}
				>
					Toggle node group sheet
					<Menubar.Shortcut>N</Menubar.Shortcut>
				</Menubar.Item>
			</Menubar.Content>
		</Menubar.Menu>

		<Menubar.Menu>
			<Menubar.Trigger>Display</Menubar.Trigger>
			<Menubar.Content>
				<Menubar.Item
					onSelect={() => {
						toggleMode();
					}}
				>
					Toggle mode <Menubar.Shortcut>⌘M</Menubar.Shortcut>
				</Menubar.Item>
			</Menubar.Content>
		</Menubar.Menu>
	</Menubar.Root>

	<AlertDialog.Root bind:open={pruneDialogOpen}>
		<AlertDialog.Portal>
			<AlertDialog.Overlay />
			<AlertDialog.Content>
				<AlertDialog.Header>
					<AlertDialog.Title>Remove unused group references?</AlertDialog.Title>
					<AlertDialog.Description>
						This will permanently delete the following group definition{prunableGroups.length ===
						1
							? ""
							: "s"} that {prunableGroups.length === 1 ? "is" : "are"} not referenced by
						any node in the project.
					</AlertDialog.Description>
				</AlertDialog.Header>
				<ul class="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
					{#each prunableGroups as group (group.ref)}
						<li
							class="flex items-center justify-between gap-4 rounded-md border px-3 py-2"
						>
							<span class="font-medium">{group.label}</span>
							<span class="text-muted-foreground tabular-nums">
								{group.nodeCount}
								{group.nodeCount === 1 ? "node" : "nodes"}
							</span>
						</li>
					{/each}
				</ul>
				<AlertDialog.Footer>
					<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
					<AlertDialog.Action onclick={confirmPruneUnused}>
						Remove {prunableGroups.length}
					</AlertDialog.Action>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Portal>
	</AlertDialog.Root>

	<Editor class="min-h-0 flex-1" />
</div>
