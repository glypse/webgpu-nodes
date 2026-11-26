import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020, { type AnySchema } from "ajv/dist/2020";

import { SCHEMA_DIR, schemaFiles } from "./schema";

const srcDir = join(import.meta.dirname, "../src");

function readSchema(path: string): AnySchema {
	const json: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (typeof json !== "object" || json === null) throw new Error(`${path} is not a schema`);
	return json;
}

const ajv = new Ajv2020({ allErrors: true });
const project = ajv.compile(readSchema(join(SCHEMA_DIR, "project.schema.json")));

describe("saved format schema", () => {
	it("matches what the schema script writes", async () => {
		for (const [name, text] of Object.entries(await schemaFiles())) {
			const checkedIn = readFileSync(join(SCHEMA_DIR, name), "utf8");
			if (checkedIn !== text) {
				throw new Error(`${name} is out of date: run \`bun run schema:build\``);
			}
		}
	});

	it("accepts every scene", () => {
		const scenesDir = join(srcDir, "scenes");
		const scenes = readdirSync(scenesDir).filter((f) => f.endsWith(".json"));
		expect(scenes.length).toBeGreaterThan(0);
		for (const file of scenes) {
			const json: unknown = JSON.parse(readFileSync(join(scenesDir, file), "utf8"));
			const valid = project(json);
			expect(valid, `${file}: ${ajv.errorsText(project.errors)}`).toBe(true);
		}
	});

	it("rejects a project with an unknown node type", () => {
		const invalid = {
			definitions: {
				root: {
					nodes: [{ id: "a", type: "not-a-node", data: {}, position: { x: 0, y: 0 } }],
					edges: [],
				},
			},
		};
		expect(project(invalid)).toBe(false);
	});
});
