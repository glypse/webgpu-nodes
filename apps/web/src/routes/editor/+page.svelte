<script lang="ts">
	import { Editor, GraphManager, setGraphManager } from "@org/editor";
	import { Menubar } from "@org/theme/components/ui";
	import { toggleMode } from "mode-watcher";

	const graph = new GraphManager();
	setGraphManager(graph);

	function handleUpload() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.onchange = () => {
			if (input.files?.[0]) void graph.upload(input.files[0]);
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

<div class="w-dvw h-dvh flex flex-col">
	<Menubar.Root class="rounded-none border-t-0 border-l-0 border-r-0 p-2 gap-1 h-auto">
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

	<Editor class="flex-1 min-h-0" />
</div>
