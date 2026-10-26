# $core

The headless half of webgpu-nodes: the graph model (documents, groups, repeat zones, type inference, undo history), the node library and the WGSL code generator. It depends on no UI framework, so any front end, or none, can drive it:

```ts
import { GraphModel, generateShader } from "$core";

const graph = new GraphModel();
graph.loadFromString(projectJson); // validates, like loading a saved project in the editor
const { shader } = generateShader(graph);
```

[$editor](../editor/) is the Svelte front end built on it.
