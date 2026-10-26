# $core

## 0.1.0

### Minor Changes

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`f6eb82d`](https://github.com/glypse/webgpu-nodes/commit/f6eb82d32c87b5a51e000bc091393d15150f5f53) Thanks [@glypse](https://github.com/glypse)! - Add automatic layout to the Edit menu: Layout selected nodes, Layout document (the graph or node group in view) and Layout graph (every document of the project). Nodes are arranged in columns following their links, with crossings minimised along each node's sockets and every repeat zone kept together; the nodes keep their top-left corner. Layouts use the nodes' sizes as drawn.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`98c7517`](https://github.com/glypse/webgpu-nodes/commit/98c7517fb1265f570d01f0a04b67f847a2d78d9b) Thanks [@glypse](https://github.com/glypse)! - Add a colour input control: it turns a vec3f / vec4f input (e.g. the Output node's) into a swatch opening a compact colour picker: RGB, HSV or OKLch fields, alpha, hex and a screen eyedropper where the browser has one, picked on a hue / saturation wheel and value ramp, or in OKLch on the Color node's gamut-aware wheel and lightness gauge. Colours are stored as linear RGB; hex, HSV and swatches are shown sRGB-encoded.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`6f8e7da`](https://github.com/glypse/webgpu-nodes/commit/6f8e7da24975e49718775b4dc21b2d80ffe973cb) Thanks [@glypse](https://github.com/glypse)! - Dropping a link on empty space opens the add menu with only the nodes that can take it, offering nodes whose type is picked (Declare) in the type that fits it: "Declare vec3f" to feed a vec3f input, or "Declare vec2f" … "Declare vec4f" to combine a dragged f32 into a vector. The picked node is created at the drop point and linked (to the best-matching input or output, or a repeat zone's new state item).

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`81f5bc5`](https://github.com/glypse/webgpu-nodes/commit/81f5bc5151afa16ecb76b80fe2aa7fd3055a95e0) Thanks [@glypse](https://github.com/glypse)! - Find nodes in the add menu by the names other tools give them (e.g. "Combine XYZ" finds Declare, "Map Range" finds Remap), the matched name shown next to the node's.
