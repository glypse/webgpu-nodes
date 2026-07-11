import type { HandleDef, NodeDescriptor } from "../types";

export function buildGroupOutputDescriptor(handles: HandleDef[]): NodeDescriptor {
	return {
		type: "group-output",
		label: "Group Output",
		category: "output",
		inputs: handles.map((h) => ({ name: h.id, type: h.type })),
		outputs: [],
		defaultData: { handles: [] },
		wgsl: () => {
			// unreachable — group-input/group-output are handled by type name in
			// codegen's generateBody, never via this generic path. Kept only because
			// NodeDescriptor requires the field.
			throw new Error("unreachable");
		},
	};
}
