# $editor

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
