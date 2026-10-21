import { describe, expect, it } from "vitest";

import { generateShader } from ".";
import type { GraphProject } from "../graph/document";
import { GraphModel } from "../graph/model";
import { debugScene as debugProject, defaultScene as defaultProject } from "../scenes";
import { nagaBin, validateFragment } from "../testing/wgsl";

describe.skipIf(!nagaBin)("generated WGSL validates with naga", () => {
	it("default project", () => {
		const { shader } = generateShader(new GraphModel(defaultProject));
		expect(validateFragment(shader)).toBeNull();
	});

	it("debug project", () => {
		const { shader } = generateShader(new GraphModel(debugProject));
		expect(validateFragment(shader)).toBeNull();
	});
});

describe.each([
	["default project", defaultProject],
	["debug project", debugProject],
])("%s wiring", (_name, project: GraphProject) => {
	it("connects every edge to a handle that exists", () => {
		const graph = new GraphModel(project);
		const dangling: string[] = [];
		for (const [ref, doc] of graph.project.definitions) {
			for (const edge of doc.edges) {
				const outputs = graph.resolveNodeOutputs(edge.source).map((o) => o.id);
				const inputs = graph.resolveNodeInputs(edge.target).map((i) => i.id);
				if (!outputs.includes(edge.sourceHandle) || !inputs.includes(edge.targetHandle)) {
					const target = doc.nodesById.get(edge.target)?.type ?? "?";
					dangling.push(`${ref}: ${edge.sourceHandle} -> ${target}.${edge.targetHandle}`);
				}
			}
		}
		expect(dangling).toEqual([]);
	});
});
