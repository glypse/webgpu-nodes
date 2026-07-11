import type { HandleDef, NodeDescriptor } from "../types";

export function buildGroupInputDescriptor(handles: HandleDef[]): NodeDescriptor {
	return {
		type: "group-input",
		label: "Group Input",
		category: "input",
		inputs: [],
		outputs: handles.map((h) => ({ name: h.id, type: h.type })),
		defaultData: { handles: [] },
		wgsl: () => {
			// unreachable — group-input/group-output are handled by type name in
			// codegen's generateBody, never via this generic path. Kept only because
			// NodeDescriptor requires the field.
			throw new Error("unreachable");
		},
	};
}
