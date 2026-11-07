import { describe, expect, it } from "bun:test";

import { generateRenderPlan } from "../codegen";
import { standardLibrary } from "../library";
import { defaultScene } from "../scenes";
import { rootProject } from "../testing/graph";
import { type GraphDocument, type GraphDocumentNode, type GraphProject, ROOT_ID } from "./document";
import { MAX_CASES, MAX_DEFINITIONS, MAX_GROUP_DEPTH } from "./limits";
import { GraphModel } from "./model";
import { documentIssues, type GraphIssue, projectIssues } from "./validate";

const at = { x: 0, y: 0 };

function groupNode(id: string, definitionRef: string): GraphDocumentNode {
	return {
		id,
		type: "node-group",
		data: {},
		position: at,
		group: { definitionRef, locked: false },
	};
}

const empty: GraphDocument = { nodes: [], edges: [] };

function kinds(project: GraphProject): GraphIssue["kind"][] {
	return projectIssues(project, () => false).map((issue) => issue.kind);
}

/** What loading `json` fails with; a model showing another project keeps it. */
async function rejection(json: string): Promise<string> {
	const model = new GraphModel(rootProject([{ id: "mine", type: "sin" }], []));
	const before = model.getProjectJson();
	const result = await model.loadFromString(json);
	if (result.ok) throw new Error("loaded");
	expect(model.getProjectJson()).toBe(before);
	return result.error.kind;
}

describe("loading a project", () => {
	it("accepts what the app ships", () => {
		expect(kinds(defaultScene)).toEqual([]);
		for (const entry of standardLibrary) {
			expect(documentIssues(entry.ref, entry.definition)).toEqual([]);
		}
	});

	it("rejects what isn't JSON or a project", async () => {
		expect(await rejection("{")).toBe("invalid-json");
		expect(await rejection(`{"definitions": 1}`)).toBe("invalid-schema");
	});

	it("rejects a project without a root", async () => {
		expect(await rejection(`{"definitions":{}}`)).toBe("invalid-graph");
	});

	it("rejects link cycles, a self-link and a cycle through a zone", () => {
		const cycle = rootProject(
			[
				{ id: "a", type: "sin" },
				{ id: "b", type: "sin" },
			],
			[
				["a", "result", "b", "e"],
				["b", "result", "a", "e"],
			],
		);
		expect(kinds(cycle)).toEqual(["edge-cycle"]);
		expect(kinds(rootProject([{ id: "a", type: "sin" }], [["a", "result", "a", "e"]]))).toEqual(
			["edge-cycle"],
		);
		const zone = rootProject(
			[
				{ id: "in", type: "repeat-input", data: { pairedOutput: "out-zone" } },
				{ id: "out-zone", type: "repeat-output" },
			],
			[["out-zone", "x", "in", "x"]],
		);
		expect(kinds(zone)).toEqual(["edge-cycle"]);
	});

	it("rejects ids used twice and links to nothing", () => {
		const doubled = rootProject(
			[
				{ id: "a", type: "sin" },
				{ id: "a", type: "sin" },
			],
			[],
		);
		expect(kinds(doubled)).toEqual(["duplicate-id"]);
		const dangling = rootProject([{ id: "a", type: "sin" }], [["a", "result", "gone", "e"]]);
		expect(kinds(dangling)).toEqual(["dangling-edge"]);
	});

	it("keeps links to sockets it doesn't know, which hidden inputs have", () => {
		const hidden = rootProject(
			[
				{ id: "a", type: "sin" },
				{ id: "b", type: "sin" },
			],
			[["a", "result", "b", "gone"]],
		);
		expect(kinds(hidden)).toEqual([]);
	});

	it("rejects groups nesting themselves, or nesting the root", () => {
		const project: GraphProject = {
			definitions: {
				[ROOT_ID]: { nodes: [groupNode("g", "a")], edges: [] },
				a: { nodes: [groupNode("n", "b")], edges: [] },
				b: { nodes: [groupNode("n2", "a")], edges: [] },
			},
		};
		expect(kinds(project)).toEqual(["group-cycle"]);
		const root: GraphProject = {
			definitions: { [ROOT_ID]: empty, a: { nodes: [groupNode("n", ROOT_ID)], edges: [] } },
		};
		expect(kinds(root)).toEqual(["root-instance"]);
	});

	it("rejects groups nested too deep, or too many of them", async () => {
		const definitions: GraphProject["definitions"] = { [ROOT_ID]: empty };
		for (let i = 0; i <= MAX_GROUP_DEPTH + 1; i++) {
			definitions[`d${String(i)}`] = {
				nodes: [groupNode(`n${String(i)}`, `d${String(i + 1)}`)],
				edges: [],
			};
		}
		expect(kinds({ definitions })).toEqual(["groups-too-deep"]);

		const many = Object.fromEntries(
			Array.from({ length: MAX_DEFINITIONS + 1 }, (_, i) => [String(i), empty]),
		);
		expect(
			await rejection(JSON.stringify({ definitions: { ...many, [ROOT_ID]: empty } })),
		).toBe("invalid-schema");
	});

	it("rejects definitions posing as the standard library's", async () => {
		const [entry] = standardLibrary;
		if (!entry) throw new Error("no library");
		const spoof = { definitions: { [ROOT_ID]: empty, [`${entry.id}@deadbeef`]: empty } };
		expect(await rejection(JSON.stringify(spoof))).toBe("invalid-graph");
	});

	it("rejects counts that would hang codegen", async () => {
		const switches = (cases: number) =>
			JSON.stringify(rootProject([{ id: "s", type: "index-switch", data: { cases } }], []));
		expect(await rejection(switches(1e9))).toBe("invalid-schema");
		expect(await rejection(switches(0.5))).toBe("invalid-schema");
		const loaded = new GraphModel();
		expect((await loaded.loadFromString(switches(MAX_CASES))).ok).toBe(true);
	});

	it("rejects numbers JSON can't write back", async () => {
		const project = JSON.stringify(rootProject([{ id: "a", type: "sin" }], []));
		expect(await rejection(project.replace(`"x":0`, `"x":1e999`))).toBe("invalid-schema");
	});

	it("rejects a camera without a zoom, and areas sharing an id", async () => {
		const camera = { ...rootProject([], []) };
		const root = camera.definitions[ROOT_ID];
		if (!root) throw new Error("no root");
		root.viewport = { x: 0, y: 0, zoom: 0 };
		expect(await rejection(JSON.stringify(camera))).toBe("invalid-schema");

		const area = {
			id: "same",
			rect: { left: 0, top: 0, right: 1, bottom: 1 },
			editor: { type: "preview" },
		};
		const layout = { areas: [area, area] };
		expect(await rejection(JSON.stringify({ ...rootProject([], []), layout }))).toBe(
			"invalid-schema",
		);
	});

	it("leaves the project as it was when loading fails midway", async () => {
		class Failing extends GraphModel {
			failing = false;
			override rebuildTypeCache() {
				if (this.failing) {
					this.failing = false;
					throw new Error("midway");
				}
				super.rebuildTypeCache();
			}
		}
		const model = new Failing(rootProject([{ id: "mine", type: "sin" }], []));
		const before = model.getProjectJson();
		model.addNode("sin", at);
		const edited = model.getProjectJson();
		expect(edited).not.toBe(before);
		model.recordHistory();

		model.failing = true;
		const result = await model.loadFromString(
			JSON.stringify(rootProject([{ id: "other", type: "sin" }], [])),
		);
		expect(result).toEqual({ ok: false, error: { kind: "failed", message: "midway" } });
		expect(model.getProjectJson()).toBe(edited);
		expect(model.hasUnsavedChanges()).toBe(true);
		expect(model.history.canUndo).toBe(true);
		expect(() => generateRenderPlan(model)).not.toThrow();
	});

	it("still loads what it saves", async () => {
		const model = new GraphModel(defaultScene);
		const copy = new GraphModel();
		expect((await copy.loadFromString(model.getProjectJson())).ok).toBe(true);
		expect(copy.getProjectJson()).toBe(model.getProjectJson());
	});
});
