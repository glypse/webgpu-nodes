import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Mirror of the module Spektral wraps around our `frag()` function. Spektral
 * doesn't export its shader builder publicly, so this stub declares the same
 * bindings and an entry point calling `frag` - enough for naga to type-check
 * the generated code exactly as the browser would see it.
 */
const SPEKTRAL_PRELUDE = `
struct SpektralFrame {
	time: f32,
	delta: f32,
	resolution: vec2f,
};

@group(0) @binding(0) var<uniform> spektralFrame: SpektralFrame;

struct SpektralFragment {
	uv: vec2f,
};

var<private> spektralFragment: SpektralFragment;
`;

const SPEKTRAL_ENTRY = `
@fragment
fn spektralFragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
	spektralFragment.uv = uv;
	return frag(uv);
}
`;

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
export function validateFragment(fragment: string): string | null {
	if (!nagaBin) throw new Error("naga is not installed");
	const dir = mkdtempSync(join(tmpdir(), "webgpu-nodes-"));
	const file = join(dir, "shader.wgsl");
	try {
		writeFileSync(file, `${SPEKTRAL_PRELUDE}\n${fragment}\n${SPEKTRAL_ENTRY}`);
		const result = spawnSync(nagaBin, [file], { encoding: "utf8" });
		if (result.status === 0) return null;
		return `${result.stdout}\n${result.stderr}`.trim();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
