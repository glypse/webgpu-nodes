<script lang="ts">
	import {
		Editor,
		GraphManager,
		setDevContext,
		setGraphManager,
		type GraphDocument,
	} from "$editor";
	import { Menubar } from "$theme/components/ui";
	import { toggleMode } from "mode-watcher";

	const graph = new GraphManager();
	setGraphManager(graph);

	setDevContext(true); // TODO: Replace with `dev` from `$app/env` past 1.0 release

	function handleUpload() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.onchange = () => {
			if (input.files?.[0]) void graph.upload(input.files[0]);
		};
		input.click();
	}

	function handleExportGroup() {
		const ref = graph.selectedGroupRef;
		if (!ref) return;
		graph.exportGroup(ref);
	}

	function handleImportGroups() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.multiple = true;
		input.onchange = async () => {
			if (!input.files) return;
			const files = Array.from(input.files);
			const entries: {
				id?: string;
				name?: string;
				category?: string;
				dependencies?: string[];
				definition?: GraphDocument;
			}[] = await Promise.all(
				files.map(async (file) => {
					const text = await file.text();
					return JSON.parse(text) as {
						id?: string;
						name?: string;
						category?: string;
						dependencies?: string[];
						definition?: GraphDocument;
					};
				}),
			);
			const result = graph.importGroups(entries);
			if (result.missing.length > 0) {
				console.warn("Import completed with missing dependencies:", result.missing);
			}
		};
		input.click();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "m" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			toggleMode();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-dvh w-dvw flex-col">
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

	<Editor class="min-h-0 flex-1" />
</div>
