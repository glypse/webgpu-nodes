import type { EnumVariant, HandleDef, InputOwner, TypeBindings, TypeOwner } from "../types";

/** What enums need of a handle, whatever its type. */
type Owned = Pick<HandleDef, "id" | "owner" | "variants" | "typeOwner">;

/** The variants `handle` lies under, nearest first: its owner, its enum's owner… */
export function ownerChain(handles: readonly Owned[], handle: Owned): InputOwner[] {
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
	handles: readonly Owned[],
	handle: Owned,
	owner: { enumId: string; value?: number },
): boolean {
	return ownerChain(handles, handle).some(
		(o) => o.enumId === owner.enumId && (owner.value === undefined || o.value === owner.value),
	);
}

/** Whether an owner names an enum among `handles`, and one of its variants. */
export function ownerExists(handles: readonly Owned[], owner: InputOwner | undefined): boolean {
	const enumHandle = owner && handles.find((h) => h.id === owner.enumId);
	return !!enumHandle?.variants?.some((v) => v.value === owner?.value);
}

/** Whether bindings leave something owned by `owner` (or by none) shown. */
function ownedBy(owner: TypeOwner | undefined, bindings: TypeBindings): boolean {
	const type = owner && bindings[owner.variable];
	return type === undefined || !!owner?.types.includes(type);
}

/** The variants of an enum offered with its group's variables bound to `bindings`. */
export function availableVariants(
	variants: readonly EnumVariant[],
	bindings: TypeBindings,
): EnumVariant[] {
	return variants.filter((v) => ownedBy(v.typeOwner, bindings));
}

/** The type owners of `handle` and of the enums it lies under. */
function typeOwners(handles: readonly Owned[], handle: Owned): TypeOwner[] {
	const enums = ownerChain(handles, handle).map((o) => handles.find((h) => h.id === o.enumId));
	return [handle, ...enums].flatMap((h) => (h?.typeOwner ? [h.typeOwner] : []));
}

/**
 * The inputs a group node doesn't show with its enums on `values` and its
 * type variables bound to `bindings`: those under a variant one of them
 * isn't on, or owned by types its variable doesn't have (or under an enum
 * that is). An enum whose value is unknown (a link computing it) shows all
 * its variants' inputs.
 */
export function hiddenInputsOf(
	handles: readonly Owned[],
	values: ReadonlyMap<string, number>,
	bindings: TypeBindings = {},
): Set<string> {
	const hidden = new Set<string>();
	for (const handle of handles) {
		const offVariant = ownerChain(handles, handle).some((o) => {
			const value = values.get(o.enumId);
			return value !== undefined && value !== o.value;
		});
		const offType = typeOwners(handles, handle).some((o) => !ownedBy(o, bindings));
		if (offVariant || offType) hidden.add(handle.id);
	}
	return hidden;
}

/**
 * Whether two inputs are never shown together: they lie under different
 * variants of an enum, or are owned by none of the same types of a variable.
 */
export function shownApart(handles: readonly Owned[], a: Owned, b: Owned): boolean {
	const of = ownerChain(handles, b);
	const variants = ownerChain(handles, a).some((o) =>
		of.some((p) => p.enumId === o.enumId && p.value !== o.value),
	);
	const typesOfB = typeOwners(handles, b);
	const types = typeOwners(handles, a).some((o) =>
		typesOfB.some(
			(p) => p.variable === o.variable && !p.types.some((t) => o.types.includes(t)),
		),
	);
	return variants || types;
}
