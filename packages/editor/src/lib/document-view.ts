import type { HydratedGraphDocument } from "$core";
import { getContext, setContext } from "svelte";

/** The document a flow canvas draws, and how. */
export type DocumentView = {
	readonly document: HydratedGraphDocument;
	readonly locked: boolean;
	/** The breadcrumb path it's viewed at: types inside groups follow it. */
	readonly path: readonly string[];
	/** Make this view the one commands act on, before editing through it. */
	activate(): void;
};

const KEY = Symbol("document-view");

export function setDocumentView(view: DocumentView) {
	setContext(KEY, view);
}

export function getDocumentView(): DocumentView {
	return getContext<DocumentView>(KEY);
}
