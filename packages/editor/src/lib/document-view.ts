import type { HydratedGraphDocument } from "$core";
import { getContext, setContext } from "svelte";

/** The document a flow canvas draws, and whether it's drawn read-only. */
export type DocumentView = {
	readonly document: HydratedGraphDocument;
	readonly locked: boolean;
};

const KEY = Symbol("document-view");

export function setDocumentView(view: DocumentView) {
	setContext(KEY, view);
}

export function getDocumentView(): DocumentView {
	return getContext<DocumentView>(KEY);
}
