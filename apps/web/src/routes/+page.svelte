<script>
	import { resolve } from "$app/paths";
	import { Kbd } from "$theme";
	import TreeViewIcon from "phosphor-svelte/lib/TreeViewIcon";
</script>

<main class="p-10">
	See <a href={resolve("/editor")}>/editor</a> :)

	<h1>How to use:</h1>
	<ul>
		<li>
			<Kbd.Group>
				<Kbd.Root>MAJ</Kbd.Root>
				<span>+</span>
				<Kbd.Root>DRAG</Kbd.Root>
			</Kbd.Group>
			to select multiple nodes, then <Kbd.Root>G</Kbd.Root> to group them.
		</li>
		<li><Kbd.Root>UV</Kbd.Root> nodes CANNOT be grouped at this time</li>
		<li>
			When selecting a node group or when inside it, press <Kbd.Root>N</Kbd.Root> to bring up its
			settings.
		</li>
		<li>
			You can create your own, editable copy of any node group by opening its settings sheet
			and pressing "Copy & Edit".
		</li>
		<li>
			Nodes with <TreeViewIcon class="bg-muted inline size-5 rounded-sm p-1" /> are a node group.
			Click the <TreeViewIcon class="bg-muted inline size-5 rounded-sm p-1" /> button to enter said
			node group.
		</li>
		<li>Select a node group and press <Kbd.Root>Enter</Kbd.Root> to enter it.</li>
		<li>
			The <i>Edit</i> menu can lay nodes out in columns following their links: the selected nodes,
			the document (the graph or node group you're viewing), or the whole graph (the main graph
			and every node group you made).
		</li>
	</ul>
</main>
