# editor

The Svelte / SvelteFlow front end.

`GraphManager` extends `GraphModel`, making its state reactive and adding UI-only state (sheets) and browser file I/O. Components call model methods (`graph.updateNodeData`, `graph.setNodeType`) rather than editing node data themselves.

## Reactivity

`GraphModel` keeps its state behind overridable factories (`createState`, `createDocument`, `createHistoryCounts`). `GraphManager` returns Svelte state from them.

Documents are `ReactiveGraphDocument`s whose node and edge arrays use `$state.raw`, not `$state`, because SvelteFlow iterates them thousands of times per frame. So mutating a node property in place (`node.data.foo = bar`) is not reactive. The model only replaces nodes and reassigns arrays (as `updateNodeData` does), and new model code must do the same. If something that should update doesn't, check whether it is mutating through a `$state.raw` container. See `reactive-document.svelte.ts` and the comments there.

## Views

Code that draws a document reads it through its area's view (`GraphView`, the `DocumentView` context: `path` and `document`) and passes that `path` to type queries. It must not assume the active area.
