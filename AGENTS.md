# webgpu-nodes

A web-based node editor for WGSL fragment shaders. The project is pre-alpha: breaking changes are fine, and backwards compatibility is not a goal.

## Stack

- Bun: package manager, runtime, formatter
- TypeScript only, strict typing. No `any`, no raw JavaScript.
- Nx: monorepo orchestration
- Svelte with SvelteKit
- Tauri: planned desktop app, not yet implemented
- Our own WebGPU runtime

## Packages

Each package has its own `/AGENTS.md`, refer to it.

- `packages/core` (`$core`): headless graph model, node library, standard library, WGSL codegen.
- `packages/runtime` (`$runtime`): WebGPU rendering and project time.
- `packages/editor` (`$editor`): Svelte / SvelteFlow front end.
- `packages/theme` (`$theme`): shared UI components and tokens.

## Working here

- Graph edits and rules belong in `core`, so every front end and the tests behave the same.
- Changesets (`.changeset/*.md`) cover every user-facing change: features, behaviour, UI. Skip internal-only changes such as refactors, internal APIs, tests and tooling.
- No migration code for old saved projects or JSON. Change the schema; saved files are recreated.
- Before finishing a feature, run check and lint on the packages you changed, through Nx:

    ```bash
    bun run format && bun nx run-many --projects=editor,web --targets=check,lint,test
    ```

    Prefer `nx run-many` over per-package commands; it runs in parallel and uses the cache. Don't skip the cache.
