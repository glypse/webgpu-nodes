# core

The headless graph model: documents, groups, repeat zones, type inference, connection rules and undo history, plus the node library, standard library and WGSL codegen.

Plain TypeScript with no Svelte, SvelteFlow or DOM. Any graph edit or rule belongs here, so another front end (or none, in tests) behaves the same.

## GraphModel

`GraphModel` is one class split across files, each extending the previous:

- `model-base.ts`: state, documents, navigation, types
- `model-zones.ts`, `model-groups.ts`
- `model-custom.ts`: nodes whose sockets are their own data (Custom WGSL, Index Switch)
- `model-edits.ts`: clipboard, delete, dissolve, reset
- `model-frames.ts`: frame membership
- `model-preview.ts`: previewing a node
- `model-assets.ts`: the project's media files. Their bytes live outside the model.
- `model.ts`: history, load/save, connections

## Screen and areas

`src/screen/screen.ts` holds the layout: rectangles as window fractions, each showing a different UI panel.

Each graph area has its own `path`, stored in its editor state. `GraphModel.path` and `activeDocument` belong to the active area, the one last used, which commands and menus act on. Types are cached per path (`typesAt(path)`), because a generic group's nodes take the types of the instance they were entered through. Edits given a node id find that node's own document rather than the active one.

## Zones

A repeat zone is a `repeat-input` / `repeat-output` pair. The output owns the state items (`data.items`); the input points at it (`data.pairedOutput`).

Zone membership, nesting and invalid links are never stored. `analyzeZones` (`src/zones/analysis.ts`) derives them from the links, and it is the single source for codegen, bubble rendering and red links. Use `GraphModel.zoneAnalysis(doc)`, which is memoised on the nodes and edges arrays, rather than deriving zones again.

## Group interface

A group's inputs, outputs and input defaults live on its definition (`inputs`, `outputs`, `defaults`), edited by side (`GroupSide`). Its Group Input and Group Output nodes are views of them, and there can be any number of each.

- An output is linked on one Group Output node at a time (`connect` enforces this). Codegen reads each output from the node it is linked on.
- An input can belong to a variant of an enum input (`owner`) or to some types of a type variable (`typeOwner`). Group nodes hide it otherwise (`hiddenInputsOf`), keeping its links.
- An enum's `variantsBy` names the type variable that decides which variants it offers, each listing its `types`. Every type the enum is shown for keeps a variant (`fitVariants`).

## Standard library

`src/nodes/` builds native nodes that codegen translates to WGSL. Reusable algorithms (noise textures, UV manipulation, image filters, ...) are node groups shipped with the program.

- Each group is described in TypeScript in `scripts/stdlib/groups/`, using `builder.ts`: `group({ id, inputs, outputs, build })`. Node operators are derived from the node registry's typed descriptors. A new group needs a description too.
- `src/library/` holds the generated JSON the app loads. Never hand-write it: edit the description, then run `bun run stdlib:build` in this package. `scripts/stdlib/groups.test.ts` fails if a JSON file drifts from its description.
- Groups are laid out in the browser: `stdlib:build --editor <url>` prints a URL to open, with the built-in browser's dev server if you use it. Only groups whose JSON no longer matches are rebuilt, and their callers follow. Pass ids to rebuild specific groups, or `--all`. `--dry` builds and validates only.
- Widgets (see `scripts/stdlib/groups/color.ts`) are the one thing a group can define that users can't. This may change: the aim is to give users as much power as possible.
