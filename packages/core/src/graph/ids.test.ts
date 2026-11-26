import { describe, expect, it } from "bun:test";

import { rootProject } from "../testing/graph";
import { sequentialIds } from "./ids";
import { GraphModel } from "./model";

const linkedModel = () => {
	const graph = new GraphModel(
		rootProject(
			[
				{ id: "a", type: "declare" },
				{ id: "b", type: "add" },
			],
			[],
		),
		{ ids: sequentialIds() },
	);
	graph.connect({ source: "a", sourceHandle: "value", target: "b", targetHandle: "operands" });
	return graph;
};

describe("injected ids", () => {
	it("gives the model's new ids from the id source", () => {
		const edge = linkedModel().activeDocument.edges.find((e) => e.target === "b");
		expect(edge?.id).toBe("id1");
	});

	it("makes the same edits produce the same saved project", () => {
		expect(JSON.parse(linkedModel().getProjectJson())).toEqual(
			JSON.parse(linkedModel().getProjectJson()),
		);
	});
});
