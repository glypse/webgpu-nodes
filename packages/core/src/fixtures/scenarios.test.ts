import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as v from "valibot";

import { sequentialIds } from "../graph/ids";
import { GraphModel } from "../graph/model";
import { asCommand, type Json, observe, type Scenario, ScenarioSchema } from "./scenario";

const DIR = join(import.meta.dir, "../../../../fixtures/scenarios");

/** Each command's result as JSON: what a command returns, `null` for nothing. */
function jsonOf(value: unknown): Json {
	return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json);
}

/** Set-valued expectations are compared sorted. */
function normalise(scenario: Scenario): Scenario["expect"] {
	const { expect: wanted } = scenario;
	if (!wanted.documents) return wanted;
	const documents = Object.fromEntries(
		Object.entries(wanted.documents).map(([key, doc]) => [
			key,
			doc.links ? { ...doc, links: [...doc.links].sort() } : doc,
		]),
	);
	return { ...wanted, documents };
}

function run(scenario: Scenario): unknown {
	const model = new GraphModel(scenario.project, { ids: sequentialIds() });
	const start = model.getProjectJson();
	const results = scenario.commands.map((command) => jsonOf(model.apply(asCommand(command))));
	const saved = model.parseProject(model.getProjectJson());
	if (!saved.ok) throw new Error(`the saved project is invalid: ${JSON.stringify(saved)}`);
	return observe(model, scenario.expect, { start, results });
}

const files = readdirSync(DIR)
	.filter((file) => file.endsWith(".json"))
	.sort();

describe("scenarios", () => {
	for (const file of files) {
		it(file.replace(/\.json$/, ""), () => {
			const json: unknown = JSON.parse(readFileSync(join(DIR, file), "utf8"));
			const parsed = v.safeParse(ScenarioSchema, json);
			if (!parsed.success) {
				throw new Error(
					`${file} is not a scenario: ${JSON.stringify(v.flatten(parsed.issues))}`,
				);
			}
			const scenario = parsed.output;
			expect(run(scenario)).toEqual(normalise(scenario));
		});
	}
});
