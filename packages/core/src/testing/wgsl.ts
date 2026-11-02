import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

import { buildProgram, type UniformValue } from "../codegen";

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

/** A fragment to validate, and the uniforms it reads. */
export type Fragment = { fragment: string; uniforms?: Record<string, UniformValue> };

/**
 * `validateFragment` for each of `fragments`, several naga processes at a
 * time: for tests validating many shaders, which would otherwise mostly
 * wait on naga one at a time.
 */
export async function validateFragments(
	fragments: readonly Fragment[],
): Promise<(string | null)[]> {
	const naga = nagaBin;
	if (!naga) throw new Error("naga is not installed");
	const dir = mkdtempSync(join(tmpdir(), "webgpu-nodes-"));
	const results: (string | null)[] = [];
	let next = 0;
	const worker = async () => {
		for (let i = next++; i < fragments.length; i = next++) {
			const { fragment, uniforms = {} } = fragments[i] ?? { fragment: "" };
			const file = join(dir, `${String(i)}.wgsl`);
			writeFileSync(file, buildProgram(fragment, uniforms).code);
			const child = Bun.spawn([naga, file], { stdout: "pipe", stderr: "pipe" });
			const [stdout, stderr, status] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			results[i] = status === 0 ? null : `${stdout}\n${stderr}`.trim();
		}
	};
	try {
		await Promise.all(Array.from({ length: availableParallelism() }, worker));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return results;
}
