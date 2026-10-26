import { describe, expect, it } from "vitest";

import type { Screen } from "../screen";
import { type TestEdge, edge } from "../testing/graph";
import { FLOAT_TYPES } from "../types";
import { type GraphProject, ROOT_ID } from "./document";
import { GraphModel } from "./model";

const GROUP = "doubler";
const T = "t-id";
const at = { x: 0, y: 0 };

/** Two instances of a group generic over `T`, one fed a vec3f, the other nothing (f32). */
function project(layout?: Screen): GraphProject {
	return {
		definitions: {
			[ROOT_ID]: {
				nodes: [
					{ id: "out", type: "frag-output", data: {}, position: at },
					{
						id: "src",
						type: "declare",
						data: { types: { declare: "vec3f" } },
						position: at,
					},
					...["g1", "g2"].map((id) => ({
						id,
						type: "node-group",
						data: {},
						position: at,
						group: { definitionRef: GROUP, locked: false },
					})),
				],
				edges: ([["src", "value", "g1", "a"]] satisfies TestEdge[]).map(edge),
			},
			[GROUP]: {
				label: "Doubler",
				typeVariables: [{ id: T, name: "T", types: FLOAT_TYPES }],
				nodes: [
					{
						id: "in",
						type: "group-input",
						data: { handles: [{ id: "a", label: "A", type: { variable: T } }] },
						position: at,
					},
					{ id: "add", type: "add", data: {}, position: at },
					{
						id: "outs",
						type: "group-output",
						data: { handles: [{ id: "sum", label: "Sum", type: { variable: T } }] },
						position: at,
					},
				],
				edges: (
					[
						["in", "a", "add", "operands"],
						["in", "a", "add", "operands"],
						["add", "result", "outs", "sum"],
					] satisfies TestEdge[]
				).map(edge),
			},
		},
		...(layout ? { layout } : {}),
	};
}

/** Two graph areas side by side, each inside one instance. */
const TWO_VIEWS: Screen = {
	areas: [
		{
			id: "left",
			rect: { left: 0, top: 0, right: 0.5, bottom: 1 },
			editor: { type: "graph", path: ["g1"] },
		},
		{
			id: "right",
			rect: { left: 0.5, top: 0, right: 1, bottom: 1 },
			editor: { type: "graph", path: ["g2"] },
		},
	],
};

describe("graph views", () => {
	it("resolve a group's types from the instance each area entered it through", () => {
		const graph = new GraphModel(project(TWO_VIEWS));
		expect(graph.resolveNodeOutputType("add", ["g1"])).toBe("vec3f");
		expect(graph.resolveNodeOutputType("add", ["g2"])).toBe("f32");
	});

	it("act on the active area", () => {
		const graph = new GraphModel(project(TWO_VIEWS));
		graph.activeArea = "right";
		expect(graph.path).toEqual(["g2"]);
		expect(graph.resolveNodeOutputType("add")).toBe("f32");
		graph.exitGroup();
		expect(graph.graphArea("right")?.editor.path).toEqual([]);
		expect(graph.graphArea("left")?.editor.path).toEqual(["g1"]);
	});

	it("keep every view's types up to date after an edit", () => {
		const graph = new GraphModel(project(TWO_VIEWS));
		graph.activeArea = "right";
		graph.setNodeType("src", "vec2f");
		expect(graph.resolveNodeOutputType("add", ["g1"])).toBe("vec2f");
	});

	it("are saved with the project, and survive undo", async () => {
		const graph = new GraphModel(project(TWO_VIEWS));
		const loaded = new GraphModel();
		await loaded.loadFromString(graph.getProjectJson());
		expect(loaded.screen).toEqual(TWO_VIEWS);

		graph.setNodeType("src", "vec2f");
		graph.recordHistory();
		graph.undo();
		expect(graph.screen).toEqual(TWO_VIEWS);
	});

	it("cut paths leading through removed nodes back", () => {
		const graph = new GraphModel(project(TWO_VIEWS));
		graph.activeArea = "left";
		graph.exitGroup();
		graph.nodes = graph.nodes.filter((n) => n.id !== "g2");
		graph.setScreen(graph.screen);
		expect(graph.graphArea("right")?.editor.path).toEqual([]);
	});

	it("default to the root without a graph area", () => {
		const graph = new GraphModel(
			project({
				areas: [
					{
						id: "p",
						rect: { left: 0, top: 0, right: 1, bottom: 1 },
						editor: { type: "preview" },
					},
				],
			}),
		);
		expect(graph.activeArea).toBeNull();
		expect(graph.path).toEqual([]);
		expect(graph.resolveNodeOutputType("add")).toBe("f32");
	});
});
