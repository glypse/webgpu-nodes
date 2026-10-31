# webgpu-nodes guidelines

A web-based node-based fragment shader editor for WGSL

### Roadmap

- A WGSL string builder handling all major value types and operations
- A proper handling of native & custom uniforms (ie: time, canvas resolution, texture, texture dimensions and texture sampling, etc)
- A user-friendly UI for handling the node editor
- A JSON load/save system for user-created scenes
- A Tauri desktop app bundling a WebGPU runtime, allowing for local, offline shader creation

### Pre-alpha

This project is in pre-alpha: every change can afford to be breaking, no backwards-compatibilty should even be considered.

## Tech stack:

- Bun as package manager and runtime
- Typescript-only, no raw Javascript, with strict typing (ie: no `any` types)
- Nx as the monorepo orchestrator tool
- Svelte as framework, SvelteKit as meta-framework
- (Not yet implemented) Tauri as the desktop app framework
- Our own WebGPU runtime (`packages/runtime`)

## Instructions

Assume your knowledge of these tools to be vastly outdated, don't be afraid to fetch the appropriate documentation (ideally via an MCP server if your user has some available for you, or via your built-in web scraping tool, or as a last resort via reading the source code in `node_modules`).

Whenever you're done working on a feature, run check and lint on the whole package or packages you've been working on. Example: `bun run format && bun nx run-many --projects=editor,web --targets=check,lint`. Always prefer using NX run-many because it's much faster (parallel execution) than individual commands, and is configured for caching.

Given the nature of this project, it's easy for the UI to not reflect the same state as the computed types and codegen, group references, etc. Make an effort to keep a single source of truth.

## Packages

- `packages/core` (`$core`): the headless graph model (`GraphModel`: documents, groups, repeat zones, type inference, connection rules, undo history), the node library, the standard library and WGSL code generation. Plain TypeScript: **no Svelte, no SvelteFlow, no DOM**. Any graph edit or rule belongs here, so another front end (or none, e.g. tests) behaves the same. `GraphModel` is one class layered across files, each extending the previous: `model-base.ts` (state, documents, navigation, types), `model-zones.ts`, `model-groups.ts`, `model-custom.ts` (Custom WGSL nodes), `model-edits.ts` (clipboard, delete, dissolve, reset), `model-preview.ts` (previewing a node), then `model.ts` (history, load/save, connections).
- `packages/runtime` (`$runtime`): draws the `ShaderProgram`s core generates with WebGPU (`Renderer`, `CanvasTarget`, pixel readback for exports) and keeps project time (`Clock`, `Player`). No Svelte. Core owns the program's WGSL and uniform layout (`codegen/program.ts`); the runtime only follows that layout, so keep the two from duplicating each other.
- `packages/editor` (`$editor`): the Svelte / SvelteFlow front end. `GraphManager` extends `GraphModel`, making its state reactive and adding UI-only state (sheets) and browser file I/O. Components call model methods (e.g. `graph.updateNodeData`, `graph.setNodeType`) rather than editing node data themselves.
- `packages/theme` (`$theme`): shared UI components and tokens.

## Reactivity model

`GraphModel` keeps its state behind overridable factories (`createState`, `createDocument`, `createHistoryCounts`); the editor's `GraphManager` returns Svelte state from them. In the editor, documents are `ReactiveGraphDocument`s whose node/edge arrays use `$state.raw` (not `$state`) for performance — SvelteFlow iterates them thousands of times per frame. This means **mutations to individual node properties (e.g. `node.data.foo = bar`) are not reactive**: the model only ever replaces nodes and reassigns arrays (e.g. `updateNodeData`), and new model code must do the same. If something that should be reactive isn't, check whether you're mutating through a `$state.raw` container. See `reactive-document.svelte.ts` and the comments there. If this section is out of sync with the actual data model, please notify the user.

## Panels (areas) and views

The editor window is tiled by areas, after Blender's screens: `packages/core/src/screen/screen.ts` holds the layout (`Screen`: rectangles as window fractions, each with an editor: graph, preview or timeline) and its operations (split, join, close, dock, swap, edge moves), saved with the project as `layout` but outside undo. Several graph areas can view different documents at once, so navigation is per area: a graph area's `path` lives in its editor state, `GraphModel.path` / `activeDocument` are those of the **active** area (the one last used, which commands and menus act on), and types are cached per path (`typesAt(path)`), since a generic group's nodes take the types of the instance it was entered through. Code drawing a document reads through its area's view (`GraphView` / the `DocumentView` context: `path`, `document`) and passes that path to type queries; edits by node id find the node's own document.

## Zones (repeat loops)

A repeat zone is a `repeat-input` / `repeat-output` node pair: the output owns the state items (`data.items`), the input points at it (`data.pairedOutput`). Zone membership, nesting and invalid links are never stored: `analyzeZones` (`packages/core/src/zones/analysis.ts`) derives them from the links (Blender's rules) and is the single source of truth for codegen, the bubble rendering and red links. Use `GraphModel.zoneAnalysis(doc)` (memoised on the nodes/edges arrays) rather than re-deriving them.
