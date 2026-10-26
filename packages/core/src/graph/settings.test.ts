import { describe, expect, it } from "vitest";

import { GraphModel } from "./model";
import { defaultSettings } from "./settings";

describe("project settings", () => {
	it("default when a project has none", () => {
		expect(new GraphModel().settings).toEqual(defaultSettings());
	});

	it("are saved and loaded with the project", async () => {
		const graph = new GraphModel();
		graph.updateSettings({ ...graph.settings, colorSpace: "display-p3" });
		const loaded = new GraphModel();
		await loaded.loadFromString(graph.getProjectJson());
		expect(loaded.settings.colorSpace).toBe("display-p3");
	});

	it("reject values out of range", () => {
		const graph = new GraphModel();
		const settings = graph.settings;
		expect(
			graph.updateSettings({ ...settings, canvas: { ...settings.canvas, width: 0 } }),
		).toBe(false);
		expect(graph.settings).toBe(settings);
	});

	it("are part of the undo history and unsaved changes", () => {
		const graph = new GraphModel();
		graph.updateSettings({ ...graph.settings, timing: { fps: 24, realtime: false } });
		expect(graph.hasUnsavedChanges()).toBe(true);
		graph.recordHistory();
		graph.undo();
		expect(graph.settings.timing).toEqual(defaultSettings().timing);
		graph.redo();
		expect(graph.settings.timing).toEqual({ fps: 24, realtime: false });
	});
});
