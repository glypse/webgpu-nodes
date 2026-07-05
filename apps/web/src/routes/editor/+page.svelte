<script lang="ts">
	import { Editor, GraphManager, setGraphManager } from "@org/editor";
	import * as Menubar from "$lib/components/ui/menubar";

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
</script>

<div class="w-dvw h-dvh">
	<Menubar.Root>
		<Menubar.Menu>
			<Menubar.Trigger>File</Menubar.Trigger>
			<Menubar.Content>
				<Menubar.Item
					onSelect={() => {
						graph.save();
					}}>Save</Menubar.Item
				>
				<Menubar.Item onSelect={handleUpload}>Upload</Menubar.Item>
			</Menubar.Content>
		</Menubar.Menu>
	</Menubar.Root>
	<Editor />
</div>
