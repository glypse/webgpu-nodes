# Fixtures

Tests written as data, so the TypeScript implementation and the Rust port are checked the same way. Each kind is described by a valibot schema in `packages/core/src/fixtures/format.ts`; the comments there are the specification.

- `gpu/<name>/`: a scene drawn on the GPU. `project.json` is a saved project, with no test-only node types; `expect.json` (`GpuFixtureSchema`) says the canvas, the frames drawn in order and the checks of what's read back. Asset files sit at the paths their assets' `file` names, relative to the folder.
- `nodes/<node>.json` (`NodeTableSchema`): the agreement table of one node type or standard-library group. `cases` pin exact results, checked on the CPU and on the GPU; `sweeps` feed inputs across a canvas and compare the GPU with the CPU evaluator.
- `scenarios/`: graph-editing scenarios, a project and the commands applied to it, with the observable result.
- `perf/`: scenes for performance baselines.

Numbers that JSON can't hold are strings: `"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"`.

Runners: the browser page at `/gpu-tests` (WebGPU), `bun test` in `packages/core` for what runs on the CPU, and in the port, a Rust binary on headless wgpu.
