import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as v from "valibot";

import { GraphModel } from "../graph/model";
import { standardLibrary } from "../library";
import { registeredNodes } from "../nodes/registry";
import { evaluate } from "../testing/evaluate";
import { isTexture } from "../types";
import {
	type ExactNumber,
	exactNumber,
	type NodeTable,
	NodeTableSchema,
	type Tolerance,
} from "./format";
import { type NodeFixture, nodeFixtures } from "./node-graphs";

const DIR = join(import.meta.dir, "../../../../fixtures/nodes");
const SUBJECT = "subject";

/** Within the tolerance: off only when past both the absolute and the relative bound. */
function withinTolerance(actual: number, expected: number, tolerance: Tolerance): boolean {
	if (Object.is(actual, expected) || (Number.isNaN(actual) && Number.isNaN(expected)))
		return true;
	if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
	const off = Math.abs(actual - expected);
	return off <= tolerance.abs || off <= tolerance.rel * Math.abs(expected);
}

function mismatches(actual: readonly number[], expected: ExactNumber[], tolerance?: Tolerance) {
	const found: string[] = [];
	if (actual.length !== expected.length) {
		return [`${String(actual.length)} components for ${String(expected.length)} expected`];
	}
	expected.forEach((e, i) => {
		const a = actual[i];
		const want = exactNumber(e);
		if (a === undefined) return;
		const ok = tolerance ? withinTolerance(a, want, tolerance) : Object.is(a, want);
		if (!ok) found.push(`component ${String(i)}: ${String(a)}, expected ${String(want)}`);
	});
	return found;
}

function loadTables(): { file: string; table: NodeTable }[] {
	return readdirSync(DIR)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => {
			const json: unknown = JSON.parse(readFileSync(join(DIR, file), "utf8"));
			return { file, table: v.parse(NodeTableSchema, json) };
		});
}

describe("node tables", () => {
	const tables = loadTables();

	it("has a table for every registered node", () => {
		const files = new Set(tables.map(({ file }) => file.replace(/\.json$/, "")));
		const missing = registeredNodes()
			.map(([type]) => type)
			.filter((type) => !files.has(type));
		expect(missing).toEqual([]);
	});

	it("has a table for every standard-library group", () => {
		const files = new Set(tables.map(({ file }) => file.replace(/\.json$/, "")));
		const missing = standardLibrary.map((entry) => entry.id).filter((id) => !files.has(id));
		expect(missing).toEqual([]);
	});

	for (const { file, table } of tables) {
		describe(file, () => {
			it("names its node after the file", () => {
				expect(table.node).toBe(file.replace(/\.json$/, ""));
			});

			if (table.skip !== undefined) {
				it(`is skipped: ${table.skip}`, () => {
					expect(table.cases).toEqual([]);
					expect(table.sweeps).toEqual([]);
				});
				return;
			}

			let fixtures: NodeFixture[];
			try {
				fixtures = nodeFixtures(table);
			} catch (error) {
				it("builds its fixtures", () => {
					throw error;
				});
				return;
			}

			for (const fixture of fixtures) {
				if (fixture.expect) {
					it(fixture.name, () => {
						expectCase(fixture);
					});
				} else {
					it(fixture.name, () => {
						expectBuilt(fixture);
					});
				}
			}
		});
	}
});

function expectCase(fixture: NodeFixture): void {
	const expected = fixture.expect;
	if (!expected) throw new Error(`"${fixture.name}" has no expectation`);
	const model = new GraphModel(fixture.project);
	const actual = evaluate(model, SUBJECT, expected.output, expected.colorSpace);
	expect(mismatches(actual, expected.values, expected.tolerance)).toEqual([]);
}

/** A sweep has no CPU result to pin: its project must build and every socket resolve. */
function expectBuilt(fixture: NodeFixture): void {
	const model = new GraphModel(fixture.project);
	for (const input of model.resolveNodeInputs(SUBJECT)) {
		expect(isTexture(model.resolveInputType(SUBJECT, input.id))).toBe(false);
	}
	for (const output of model.resolveNodeOutputs(SUBJECT)) {
		expect(isTexture(model.resolveOutputHandleType(SUBJECT, output.id))).toBe(false);
	}
}
