# $editor

## 0.6.0

### Minor Changes

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`926f7f0`](https://github.com/glypse/webgpu-nodes/commit/926f7f0dccc8569be28dbc5de46926e38849c965) Thanks [@glypse](https://github.com/glypse)! - The add menu (right-click, or Shift+A at the pointer) has a search field as its first item, focused on open: typing replaces the category submenus with every matching node, and Enter adds the best match.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`d1c8c24`](https://github.com/glypse/webgpu-nodes/commit/d1c8c2499c1b4b7e81844b95189b1959e0df8132) Thanks [@glypse](https://github.com/glypse)! - Add a Fallback node, and an Aspect UV group to the standard library. Fallback uses its value when one is passed and its default otherwise; inside a group, an input whose socket is left unlinked counts as not passed, so the group can compute its own default. Aspect UV scales coordinates to the canvas aspect ratio, with a Contain (fit), Cover (fill) or Stretch mode picked from a dropdown (or driven by a value), only the picked one being computed; left unlinked, its coordinates fall back to the fragment UV.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`f6eb82d`](https://github.com/glypse/webgpu-nodes/commit/f6eb82d32c87b5a51e000bc091393d15150f5f53) Thanks [@glypse](https://github.com/glypse)! - Add automatic layout to the Edit menu: Layout selected nodes, Layout document (the graph or node group in view) and Layout graph (every document of the project). Nodes are arranged in columns following their links, with crossings minimised along each node's sockets and every repeat zone kept together; the nodes keep their top-left corner. Layouts use the nodes' sizes as drawn.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`3f0fc7f`](https://github.com/glypse/webgpu-nodes/commit/3f0fc7fb741e8bd60c27dea4e36b57e7df6623ac) Thanks [@glypse](https://github.com/glypse)! - Add a Color node, a standard-library group: pick RGB, HSV or OKLch, each with its own inputs (Red, Green, Blue; Hue, Saturation, Value; Lightness, Chroma, Hue) and an alpha, and get both the colour (vec3f) and the colour with alpha (vec4f). Only the picked mode's conversion is computed, and OKLch colours outside sRGB are mapped into it as CSS Color 4 does, keeping their lightness and hue and lowering their chroma. Unlinked, the components are edited on the node: with a hue / saturation wheel and value ramp in RGB and HSV (locked in RGB while any component is linked), and in OKLch with a hue and chroma wheel at the colour's lightness and a lightness gauge at its chroma and hue, with a line tracing the sRGB gamut's edge; colours outside it show what they're mapped to. Components are kept within their range while edited: lightness and chroma within 0 to 1, hue within 0 to 360 in OKLch, and HSV and alpha within 0 to 1. Changing the mode converts the components so the colour stays the same; a clone (Clone & Edit) is an ordinary group, without the widget.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`98c7517`](https://github.com/glypse/webgpu-nodes/commit/98c7517fb1265f570d01f0a04b67f847a2d78d9b) Thanks [@glypse](https://github.com/glypse)! - Add a colour input control: it turns a vec3f / vec4f input (e.g. the Output node's) into a swatch opening a compact colour picker: RGB, HSV or OKLch fields, alpha, hex and a screen eyedropper where the browser has one, picked on a hue / saturation wheel and value ramp, or in OKLch on the Color node's gamut-aware wheel and lightness gauge. Colours are stored as linear RGB; hex, HSV and swatches are shown sRGB-encoded.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`8081029`](https://github.com/glypse/webgpu-nodes/commit/80810290fe4d980913713d78b7a439e3ece78f4f) Thanks [@glypse](https://github.com/glypse)! - Add colour space conversions to the standard library: Linear RGB to and from XYZ, OKLab and OKLch, XYZ to and from OKLab, and OKLab to and from OKLch (hue in degrees). Every route to OKLab gives the same result as the colour picker. OKLch Gamut Map turns an OKLch colour into linear RGB within sRGB as CSS Color 4 does, and In sRGB Gamut tells whether a colour is within it.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`e11ff30`](https://github.com/glypse/webgpu-nodes/commit/e11ff30ddda92a5e2afa7fa78b4df595fa36e363) Thanks [@glypse](https://github.com/glypse)! - Add a Curve node, mapping each component of a float or float vector through a curve drawn on the node, as Blender's Float Curve does. Click the curve to add a point on it without changing its shape, Ctrl-click to add one anywhere, drag points and the selected point's handles (Ctrl snaps to a grid, Shift moves finely), and Delete removes the selected point. Each point is Vector (no handles, so segments between two of them are straight), Free, Aligned (opposite handles, each with its length) or Mirrored (opposite handles of the same length), and its position and its handles' can be typed. Presets sit beside the graph, and two buttons flip the curve left to right or upside down. Its Factor mixes the value with its mapping: scrubbing goes from 0 to 1, while typing accepts any value from 0, exaggerating the mapping past 1. Moving points doesn't recompile the shader.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`afc6404`](https://github.com/glypse/webgpu-nodes/commit/afc64041dc41e51a764ebd2f316155e3ac450564) Thanks [@glypse](https://github.com/glypse)! - Add a Developer tools toggle to the File menu, on by default in a development server. The nodes made to test shader error reporting (Bad WGSL, Runtime Error) are only offered in the add menu while it's on, as are the shader logs in the console; the dummy standard-library group is gone.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`6f8e7da`](https://github.com/glypse/webgpu-nodes/commit/6f8e7da24975e49718775b4dc21b2d80ffe973cb) Thanks [@glypse](https://github.com/glypse)! - Dropping a link on empty space opens the add menu with only the nodes that can take it, offering nodes whose type is picked (Declare) in the type that fits it: "Declare vec3f" to feed a vec3f input, or "Declare vec2f" … "Declare vec4f" to combine a dragged f32 into a vector. The picked node is created at the drop point and linked (to the best-matching input or output, or a repeat zone's new state item).

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`ac6dfba`](https://github.com/glypse/webgpu-nodes/commit/ac6dfbacb9e884ab2f4d63ebd64b49a66b55cfce) Thanks [@glypse](https://github.com/glypse)! - Add i32, u32 and bool value types (scalars and vectors) with Blender-like implicit conversions between them, plus new nodes: Compare, Switch, Boolean Math, Not, Any / All, Modulo, Negate, Bitwise, Bitwise Not, Bit Shift, To Float, To Integer, To Unsigned and To Boolean. Nodes can now expose enum settings, and handle shapes show the scalar kind.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`9b6b696`](https://github.com/glypse/webgpu-nodes/commit/9b6b6969976dae87ead0cb0fb4241b425ea9d294) Thanks [@glypse](https://github.com/glypse)! - Add repeat zones (loops), like Blender's geometry-nodes repeat zone: a Repeat Input / Repeat Output pair carrying typed state items across iterations, with an iteration index, a dynamic iteration count clamped by a per-zone safety cap, and nested zones. Nodes linked from the Repeat Input run once per iteration inside a bubble drawn around the zone, while loop invariants stay outside and are computed once. Links leaving a zone are drawn red and ignored, connections that would break zone rules or close a cycle are refused, zone nodes are deleted and grouped as a pair, and dropping a link on a zone's "new item" socket creates a state item of the right type.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`bf5fa74`](https://github.com/glypse/webgpu-nodes/commit/bf5fa746ccf459dd3a66cbcc8855120e1f7ab3c2) Thanks [@glypse](https://github.com/glypse)! - Edit a group's vec3f and vec4f inputs as colours: in the group settings sheet, an input's details pick whether group nodes show it as numbers, a colour swatch opening the picker, or a colour wheel drawn on the node.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`5e12790`](https://github.com/glypse/webgpu-nodes/commit/5e1279062c4502f0f49a21f33a4065dbae9d48e6) Thanks [@glypse](https://github.com/glypse)! - Give a group's numeric inputs a minimum and a maximum in the group settings sheet, each optional: group nodes keep the value within it while it's edited, and linked values pass as they are.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`9b6997f`](https://github.com/glypse/webgpu-nodes/commit/9b6997f8a0d1944d74d2506a29919acf4734e3bf) Thanks [@glypse](https://github.com/glypse)! - Edit a group's sockets from its settings sheet: add inputs (an enum among them) and outputs there, edit an enum's variants (rename, reorder, add, remove) under it, and open an input's details to set its default value. Group nodes now start with their inputs' default values.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`974150f`](https://github.com/glypse/webgpu-nodes/commit/974150f4fb0572662c893ad505ce200a8284979c) Thanks [@glypse](https://github.com/glypse)! - Let a group's outputs be "Inferred": they then carry whatever reaches them inside the group, so each group node's output takes the type its inputs lead to. Pick it from an output's type menu in the group settings sheet, or when adding an output.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`f9a3e13`](https://github.com/glypse/webgpu-nodes/commit/f9a3e137f00d544b60d0d4d2877ed2cbb40c5bae) Thanks [@glypse](https://github.com/glypse)! - Add a Match node, picking a value by the variant of the enum linked to it: it has one input per variant, so adding, renaming, reordering or removing a variant updates its cases and keeps their links. Its value type is inferred from its cases or picked, as for a Switch. When a group node sets the enum's value, only the picked case is computed.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`81f5bc5`](https://github.com/glypse/webgpu-nodes/commit/81f5bc5151afa16ecb76b80fe2aa7fd3055a95e0) Thanks [@glypse](https://github.com/glypse)! - Find nodes in the add menu by the names other tools give them (e.g. "Combine XYZ" finds Declare, "Map Range" finds Remap), the matched name shown next to the node's.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`7edbc61`](https://github.com/glypse/webgpu-nodes/commit/7edbc6160b860a938085a88f7fef17eac581a79e) Thanks [@glypse](https://github.com/glypse)! - The Output node takes a vec3f as well as a vec4f: a vec3f colour is shown opaque (alpha 1) instead of being padded with a zero alpha, and narrower values (scalars, vec2f) become an opaque vec3f.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`9230ee4`](https://github.com/glypse/webgpu-nodes/commit/9230ee40e80010b310e767ad0061409c1f6ebaea) Thanks [@glypse](https://github.com/glypse)! - Make Remap a standard-library group, with Value, From Min, From Max, To Min and To Max inputs. Like before, it works on floats and float vectors, taking its type from what's linked to it (or the one picked on the node).

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`aac1fa0`](https://github.com/glypse/webgpu-nodes/commit/aac1fa0b3a65245b49acf733b6b8408766ffe7e2) Thanks [@glypse](https://github.com/glypse)! - Add a Reroute node (Miscellaneous): a single handle that links can go through, keeping their type. Links between two reroutes show an arrow in their middle.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`9ba94b2`](https://github.com/glypse/webgpu-nodes/commit/9ba94b25e54bca5d07caec06ea03db3f04b7ec4d) Thanks [@glypse](https://github.com/glypse)! - Let a group's sockets share types. In the group settings sheet, add shared types (T, U…), each allowing a set of types (Float, Integer, Any number…), and give sockets one from their type menu ("New shared type" makes one from a socket). On each group node, sockets sharing a type take the same one, inferred from what's linked to them like a built-in node's, and each shared type gets a picker to force it. Different shared types are inferred independently, and a group entered through a group node shows its types inside.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`d7ff179`](https://github.com/glypse/webgpu-nodes/commit/d7ff17961b9df4037c2986e17327479347a33b36) Thanks [@glypse](https://github.com/glypse)! - Standard-library groups are versioned: saved projects record which version of each one they use. A node using an older version than the editor's shows a warning icon explaining the difference.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`12a26de`](https://github.com/glypse/webgpu-nodes/commit/12a26dea14e080e3e18a0e7a871e1c4741a1f0de) Thanks [@glypse](https://github.com/glypse)! - Types are picked from one TypePicker menu everywhere (a node's type, adding or changing group and repeat-zone values): browsable submenus per kind (float, integer, unsigned, boolean) instead of long lists or grids. Group input/output values can now change type from the group sheet. On a node, the menu's first option is the type inferred from its links, shown as "[type] (inferred)" until another type is forced, which replaces the reset button.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`bb9eadf`](https://github.com/glypse/webgpu-nodes/commit/bb9eadfec3990c4e3f78f9fdf01de7b3660b3c5e) Thanks [@glypse](https://github.com/glypse)! - Node data is now stored in typed fields (input values, settings, picked types, handles, zone data) and validated strictly on load. Projects saved before this change no longer load.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`9fb5f92`](https://github.com/glypse/webgpu-nodes/commit/9fb5f9295e552cfd89c5102b7e6914275ba19e12) Thanks [@glypse](https://github.com/glypse)! - Add undo / redo (⌘Z / ⇧⌘Z or Ctrl+Y, and in the Edit menu). Every change to the project is undoable; a drag or a scrub counts as a single step.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`064740d`](https://github.com/glypse/webgpu-nodes/commit/064740db44236334a0daef0ecbbde040abe66715) Thanks [@glypse](https://github.com/glypse)! - Give each variant of a group's enum input its own inputs: in the group settings sheet, every variant lists its inputs and has its own Add input button, and group nodes show only the inputs of the variants they're on (all of them while the enum is linked to a value computed in the shader). Inputs of the other variants hide even when linked: their links are kept, undrawn, and come back with the variant. Enums can nest under a variant. Removing a variant or an enum removes its inputs, and inputs never shown together may share a label.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`0c438c8`](https://github.com/glypse/webgpu-nodes/commit/0c438c8949d44db3b8304a3e13f36622737f17e7) Thanks [@glypse](https://github.com/glypse)! - Warn before leaving the editor page when the project has unsaved changes (camera moves don't count).

### Patch Changes

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`213b956`](https://github.com/glypse/webgpu-nodes/commit/213b95626c00dca0184d1894c7cdcae46411f87c) Thanks [@glypse](https://github.com/glypse)! - Show the canvas in the colours the pickers show: on HDR displays the preview drew linear colours without encoding them to sRGB, making them darker and more saturated than their swatches.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`7a5ad23`](https://github.com/glypse/webgpu-nodes/commit/7a5ad23ecbecf1eb5b65d36d7983f4cd5a52ee83) Thanks [@glypse](https://github.com/glypse)! - Keep a group's shared types when cloning it to edit or exporting it, and update a cloned group node's types right away: cloning a Remap fed a vector no longer breaks the shader.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`307febd`](https://github.com/glypse/webgpu-nodes/commit/307febdef1fb23c3a903272af8a9df4539dee3b8) Thanks [@glypse](https://github.com/glypse)! - Keep the grab cursor over links inside a locked group, which can't be selected.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`c470e29`](https://github.com/glypse/webgpu-nodes/commit/c470e29c1e6a4ae6ac2b6f458182fb7386d1e0b0) Thanks [@glypse](https://github.com/glypse)! - Disable the value type picker on nodes inside a locked group.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`c8214cf`](https://github.com/glypse/webgpu-nodes/commit/c8214cfb74057e5b3814b12cac44a94ca3fa1abc) Thanks [@glypse](https://github.com/glypse)! - Show types, shared type names and hex colours in the interface font rather than a monospace one.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`61c9241`](https://github.com/glypse/webgpu-nodes/commit/61c92416a8b3d122e6cf06eac1ba913998805bc8) Thanks [@glypse](https://github.com/glypse)! - Saved projects no longer contain copies of the standard library's groups: they always come from the editor itself.
- Updated dependencies [[`f6eb82d`](https://github.com/glypse/webgpu-nodes/commit/f6eb82d32c87b5a51e000bc091393d15150f5f53), [`98c7517`](https://github.com/glypse/webgpu-nodes/commit/98c7517fb1265f570d01f0a04b67f847a2d78d9b), [`6f8e7da`](https://github.com/glypse/webgpu-nodes/commit/6f8e7da24975e49718775b4dc21b2d80ffe973cb), [`81f5bc5`](https://github.com/glypse/webgpu-nodes/commit/81f5bc5151afa16ecb76b80fe2aa7fd3055a95e0)]:
  - $core@0.1.0
  - $theme@0.3.0

## 0.5.0

### Minor Changes

- [#30](https://github.com/glypse/webgpu-nodes/pull/30) [`c00aea5`](https://github.com/glypse/webgpu-nodes/commit/c00aea544501765adf8a5ae79b8f51a9cdb58ba8) Thanks [@glypse](https://github.com/glypse)! - Inferrable types

- [#30](https://github.com/glypse/webgpu-nodes/pull/30) [`13d0db1`](https://github.com/glypse/webgpu-nodes/commit/13d0db140f3432e86f4b3117a01063a335974073) Thanks [@glypse](https://github.com/glypse)! - Float vectors now display a scrubbable input

- [#30](https://github.com/glypse/webgpu-nodes/pull/30) [`c00aea5`](https://github.com/glypse/webgpu-nodes/commit/c00aea544501765adf8a5ae79b8f51a9cdb58ba8) Thanks [@glypse](https://github.com/glypse)! - BREAKING: Replace individual vector declaration and separation nodes in a unified Declare node and Separate Vector node

- [#30](https://github.com/glypse/webgpu-nodes/pull/30) [`c572fc2`](https://github.com/glypse/webgpu-nodes/commit/c572fc2a24d00d5296366e3b84e593a88352ddb9) Thanks [@glypse](https://github.com/glypse)! - Gracefully handle shader errors with a panel

- [#30](https://github.com/glypse/webgpu-nodes/pull/30) [`22da746`](https://github.com/glypse/webgpu-nodes/commit/22da7467fcce00126008f179b420572ce296ffb1) Thanks [@glypse](https://github.com/glypse)! - Float components can be promoted (f32 -> vec3f, vec2f -> vec4f, etc)

### Patch Changes

- [#30](https://github.com/glypse/webgpu-nodes/pull/30) [`0cf6666`](https://github.com/glypse/webgpu-nodes/commit/0cf66665844b350ef79d63395f5ecad6f0ca1695) Thanks [@glypse](https://github.com/glypse)! - Only allow one input edge for non-variadic handles

- Updated dependencies [[`13d0db1`](https://github.com/glypse/webgpu-nodes/commit/13d0db140f3432e86f4b3117a01063a335974073)]:
  - $theme@0.2.0

## 0.4.0

### Minor Changes

- [#28](https://github.com/glypse/webgpu-nodes/pull/28) [`1eec8b5`](https://github.com/glypse/webgpu-nodes/commit/1eec8b54e65b2055225b361cd1b44df3f6f87e17) Thanks [@glypse](https://github.com/glypse)! - feat: node groups

## 0.3.1

### Patch Changes

- [#24](https://github.com/glypse/webgpu-nodes/pull/24) [`f5ce997`](https://github.com/glypse/webgpu-nodes/commit/f5ce997bc8c06ce9214ad94742a3abc7dc1ee70c) Thanks [@glypse](https://github.com/glypse)! - Nodes visual redesign

- Updated dependencies [[`f5ce997`](https://github.com/glypse/webgpu-nodes/commit/f5ce997bc8c06ce9214ad94742a3abc7dc1ee70c)]:
  - $theme@0.1.1

## 0.3.0

### Minor Changes

- [#21](https://github.com/glypse/webgpu-nodes/pull/21) [`879a21f`](https://github.com/glypse/webgpu-nodes/commit/879a21f8a19beea24c482b346204fa19465e4bfe) Thanks [@glypse](https://github.com/glypse)! - Add menubar with save and load and theme switch

### Patch Changes

- [#21](https://github.com/glypse/webgpu-nodes/pull/21) [`879a21f`](https://github.com/glypse/webgpu-nodes/commit/879a21f8a19beea24c482b346204fa19465e4bfe) Thanks [@glypse](https://github.com/glypse)! - Change UI font

## 0.2.0

### Minor Changes

- [#6](https://github.com/glypse/webgpu-nodes/pull/6) [`140b2c5`](https://github.com/glypse/webgpu-nodes/commit/140b2c5e54aef15fdd5b776454396f8939223f2e) Thanks [@glypse](https://github.com/glypse)! - feat: add UI control to all f32 inputs of nodes

- [#6](https://github.com/glypse/webgpu-nodes/pull/6) [`cf39841`](https://github.com/glypse/webgpu-nodes/commit/cf39841f30eeef3b7d271c5f237cfb44aa54c9c4) Thanks [@glypse](https://github.com/glypse)! - feat: add some utility nodes and uniforms

- [#6](https://github.com/glypse/webgpu-nodes/pull/6) [`c97bea8`](https://github.com/glypse/webgpu-nodes/commit/c97bea8bd1d8940b0224ef11c71649ebd09aba90) Thanks [@glypse](https://github.com/glypse)! - feat: save and upload graphs

### Patch Changes

- [#6](https://github.com/glypse/webgpu-nodes/pull/6) [`67eba90`](https://github.com/glypse/webgpu-nodes/commit/67eba9009ee92e36299d9df6e186f62a394cf032) Thanks [@glypse](https://github.com/glypse)! - perf: only generate and compute nodes connected to output

- [#6](https://github.com/glypse/webgpu-nodes/pull/6) [`0de7520`](https://github.com/glypse/webgpu-nodes/commit/0de75206fc3943c38d69319bb2cd68365ac4d017) Thanks [@glypse](https://github.com/glypse)! - feat: f32's input UI disappears when target handle is connected

## 0.1.0

### Minor Changes

- [`9f2086c`](https://github.com/glypse/webgpu-nodes/commit/9f2086c1fcdea6dd47fea1b64a7b3b819be28db6) Thanks [@glypse](https://github.com/glypse)! - feat: add nodes registry, context menu, more nodes, fix some config, and more

### Patch Changes

- [`0eb7f3d`](https://github.com/glypse/webgpu-nodes/commit/0eb7f3dca7e04d94818ad7c65c29d41f096f2168) Thanks [@glypse](https://github.com/glypse)! - chore: make editor its own package
