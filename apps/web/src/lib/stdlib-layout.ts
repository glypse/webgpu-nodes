import type { GraphManager } from "$editor";

/** The query parameter carrying the address of core's `stdlib:build` script. */
export const STDLIB_LAYOUT_PARAM = "stdlib-layout";

/**
 * Lay out the project `server` serves with the editor's measured layout, and
 * post it back. Development only: core's `stdlib:build` script opens the
 * editor with this so standard-library groups are laid out as drawn.
 */
export async function layoutServedProject(graph: GraphManager, server: string): Promise<void> {
	const response = await fetch(new URL("project", server));
	if (!(await graph.loadFromString(await response.text()))) {
		throw new Error("[stdlib-layout] the served project didn't load");
	}
	await document.fonts.ready;
	while (!graph.canvas) await new Promise(requestAnimationFrame);
	await graph.layoutProject();
	await fetch(new URL("result", server), { method: "POST", body: graph.getProjectJson() });
	graph.markSaved();
}
