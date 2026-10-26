import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type UniformValue, buildProgram } from "../codegen";

function findNaga(): string | null {
	const candidates = [
		process.env.NAGA_BIN,
		"naga",
		join(process.env.HOME ?? "", ".cargo/bin/naga"),
	];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
		if (probe.status === 0) return candidate;
	}
	return null;
}

/** Path to the `naga` CLI (`cargo install naga-cli`), or null when unavailable. */
export const nagaBin = findNaga();

/**
 * Validate a generated fragment (everything our codegen emits) with naga.
 * Returns `null` when valid, or naga's error report.
 */
export function validateFragment(
	fragment: string,
	uniforms: Record<string, UniformValue> = {},
): string | null {
	if (!nagaBin) throw new Error("naga is not installed");
	const dir = mkdtempSync(join(tmpdir(), "webgpu-nodes-"));
	const file = join(dir, "shader.wgsl");
	try {
		writeFileSync(file, buildProgram(fragment, uniforms).code);
		const result = spawnSync(nagaBin, [file], { encoding: "utf8" });
		if (result.status === 0) return null;
		return `${result.stdout}\n${result.stderr}`.trim();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
