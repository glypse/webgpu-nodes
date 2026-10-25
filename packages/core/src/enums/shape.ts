import type { HandleDef, InputOwner } from "../types";

/** The variants `handle` lies under, nearest first: its owner, its enum's owner… */
export function ownerChain(handles: readonly HandleDef[], handle: HandleDef): InputOwner[] {
	const chain: InputOwner[] = [];
	const seen = new Set<string>();
	for (let owner = handle.owner; owner && !seen.has(owner.enumId);) {
		seen.add(owner.enumId);
		chain.push(owner);
		owner = handles.find((h) => h.id === owner?.enumId)?.owner;
	}
	return chain;
}

/** Whether `owner` is the variant (one of) `handle` lies under, at any depth. */
export function isUnder(
	handles: readonly HandleDef[],
	handle: HandleDef,
	owner: { enumId: string; value?: number },
): boolean {
	return ownerChain(handles, handle).some(
		(o) => o.enumId === owner.enumId && (owner.value === undefined || o.value === owner.value),
	);
}

/** Whether an owner names an enum among `handles`, and one of its variants. */
export function ownerExists(handles: readonly HandleDef[], owner: InputOwner | undefined): boolean {
	const enumHandle = owner && handles.find((h) => h.id === owner.enumId);
	return !!enumHandle?.variants?.some((v) => v.value === owner?.value);
}

/**
 * The inputs a group node doesn't show with its enums on `values`: those
 * under a variant one of them isn't on. An enum whose value is unknown (a
 * link computing it) shows all its variants' inputs.
 */
export function hiddenByVariant(
	handles: readonly HandleDef[],
	values: ReadonlyMap<string, number>,
): Set<string> {
	const hidden = new Set<string>();
	for (const handle of handles) {
		const off = ownerChain(handles, handle).some((o) => {
			const value = values.get(o.enumId);
			return value !== undefined && value !== o.value;
		});
		if (off) hidden.add(handle.id);
	}
	return hidden;
}

/** Whether two inputs are never shown together: they lie under different variants of an enum. */
export function shownApart(handles: readonly HandleDef[], a: HandleDef, b: HandleDef): boolean {
	const of = ownerChain(handles, b);
	return ownerChain(handles, a).some((o) =>
		of.some((p) => p.enumId === o.enumId && p.value !== o.value),
	);
}
