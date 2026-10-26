<script lang="ts">
	import { type NodeData, customSockets } from "$core";
	import { Button, Popover } from "$theme";
	import PlugsIcon from "phosphor-svelte/lib/PlugsIcon";

	import { getGraphManager } from "../../graph-manager.svelte";
	import SocketsEditor from "./SocketsEditor.svelte";

	let { id, data, disabled }: { id: string; data: NodeData; disabled: boolean } = $props();

	const graph = getGraphManager();

	/** Typing recompiles the shader only once it pauses. */
	const COMMIT_DELAY_MS = 400;

	let draft = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const code = $derived(draft ?? data.code ?? "");
	const sockets = $derived(customSockets(data));

	function commit() {
		clearTimeout(timer);
		if (draft === null) return;
		graph.setCustomCode(id, draft);
		draft = null;
	}

	function handleInput(e: Event & { currentTarget: HTMLTextAreaElement }) {
		draft = e.currentTarget.value;
		clearTimeout(timer);
		timer = setTimeout(commit, COMMIT_DELAY_MS);
	}

	// Tab indents rather than leaving the editor.
	function handleKeydown(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
		if (e.key !== "Tab" || e.shiftKey) return;
		e.preventDefault();
		const area = e.currentTarget;
		const { selectionStart, selectionEnd, value } = area;
		area.value = `${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`;
		area.selectionStart = area.selectionEnd = selectionStart + 1;
		area.dispatchEvent(new Event("input", { bubbles: true }));
	}

	const signature = $derived(
		`(${sockets.inputs.map((s) => s.label).join(", ")}) → ${sockets.outputs.map((s) => s.label).join(", ") || "nothing"}`,
	);
</script>

<div class="flex flex-col gap-1 px-2 py-1">
	<div class="flex items-center gap-1">
		<span class="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={signature}>
			{signature}
		</span>
		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-xs"
						class="nodrag"
						title="Edit sockets"
						{disabled}
					>
						<PlugsIcon />
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-96" align="end">
				<SocketsEditor {id} {sockets} {disabled} />
			</Popover.Content>
		</Popover.Root>
	</div>
	<textarea
		class="nodrag nowheel nokey bg-muted/50 focus:bg-muted min-h-24 w-full resize-y rounded-sm p-2 font-mono text-[11px] leading-snug [tab-size:2] outline-none"
		spellcheck="false"
		autocomplete="off"
		aria-label="WGSL code"
		readonly={disabled}
		value={code}
		oninput={handleInput}
		onkeydown={handleKeydown}
		onblur={commit}></textarea>
</div>
