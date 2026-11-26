// Writes the JSON Schema of the saved project and groups files, the contract
// the Rust port reads with serde. The checks valibot runs beyond the JSON
// Schema's reach are listed in fixtures/schema/README.md.
//
//   bun run schema:build
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { toJsonSchema } from "@valibot/to-json-schema";

import { GraphProjectSchema, GroupsFileSchema } from "../src/graph/schema";

export const SCHEMA_DIR = join(import.meta.dirname, "../../../fixtures/schema");

const DRAFT = "https://json-schema.org/draft/2020-12/schema";

/** Checks the converter can't express are left out; the README lists them. */
const OPTIONS = { target: "draft-2020-12", errorMode: "ignore" } as const;

/** The generated files' text by file name, as the script writes them. */
export async function schemaFiles(): Promise<Record<string, string>> {
	return {
		"project.schema.json": await serialize(toJsonSchema(GraphProjectSchema, OPTIONS)),
		"groups.schema.json": await serialize(toJsonSchema(GroupsFileSchema, OPTIONS)),
	};
}

// `$schema` leads the file, though the converter puts it last. The output goes
// through `bun fmt`, whose layout the checked-in files must keep.
async function serialize(schema: object): Promise<string> {
	const json = JSON.stringify({ $schema: DRAFT, ...schema }, null, "\t");
	const proc = Bun.spawn(["bun", "fmt", "--stdin-filepath", "schema.json"], {
		cwd: import.meta.dirname,
		stdin: new Blob([json]),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	if (code !== 0) throw new Error(`bun fmt failed: ${await new Response(proc.stderr).text()}`);
	return text;
}

if (import.meta.main) {
	for (const [name, text] of Object.entries(await schemaFiles())) {
		writeFileSync(join(SCHEMA_DIR, name), text);
	}
}
