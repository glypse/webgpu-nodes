# $web

## 0.1.0

### Minor Changes

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`f6eb82d`](https://github.com/glypse/webgpu-nodes/commit/f6eb82d32c87b5a51e000bc091393d15150f5f53) Thanks [@glypse](https://github.com/glypse)! - Add automatic layout to the Edit menu: Layout selected nodes, Layout document (the graph or node group in view) and Layout graph (every document of the project). Nodes are arranged in columns following their links, with crossings minimised along each node's sockets and every repeat zone kept together; the nodes keep their top-left corner. Layouts use the nodes' sizes as drawn.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`afc6404`](https://github.com/glypse/webgpu-nodes/commit/afc64041dc41e51a764ebd2f316155e3ac450564) Thanks [@glypse](https://github.com/glypse)! - Add a Developer tools toggle to the File menu, on by default in a development server. The nodes made to test shader error reporting (Bad WGSL, Runtime Error) are only offered in the add menu while it's on, as are the shader logs in the console; the dummy standard-library group is gone.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`9fb5f92`](https://github.com/glypse/webgpu-nodes/commit/9fb5f9295e552cfd89c5102b7e6914275ba19e12) Thanks [@glypse](https://github.com/glypse)! - Add undo / redo (⌘Z / ⇧⌘Z or Ctrl+Y, and in the Edit menu). Every change to the project is undoable; a drag or a scrub counts as a single step.

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`0c438c8`](https://github.com/glypse/webgpu-nodes/commit/0c438c8949d44db3b8304a3e13f36622737f17e7) Thanks [@glypse](https://github.com/glypse)! - Warn before leaving the editor page when the project has unsaved changes (camera moves don't count).

### Patch Changes

- Updated dependencies [[`926f7f0`](https://github.com/glypse/webgpu-nodes/commit/926f7f0dccc8569be28dbc5de46926e38849c965), [`d1c8c24`](https://github.com/glypse/webgpu-nodes/commit/d1c8c2499c1b4b7e81844b95189b1959e0df8132), [`f6eb82d`](https://github.com/glypse/webgpu-nodes/commit/f6eb82d32c87b5a51e000bc091393d15150f5f53), [`213b956`](https://github.com/glypse/webgpu-nodes/commit/213b95626c00dca0184d1894c7cdcae46411f87c), [`7a5ad23`](https://github.com/glypse/webgpu-nodes/commit/7a5ad23ecbecf1eb5b65d36d7983f4cd5a52ee83), [`3f0fc7f`](https://github.com/glypse/webgpu-nodes/commit/3f0fc7fb741e8bd60c27dea4e36b57e7df6623ac), [`98c7517`](https://github.com/glypse/webgpu-nodes/commit/98c7517fb1265f570d01f0a04b67f847a2d78d9b), [`8081029`](https://github.com/glypse/webgpu-nodes/commit/80810290fe4d980913713d78b7a439e3ece78f4f), [`e11ff30`](https://github.com/glypse/webgpu-nodes/commit/e11ff30ddda92a5e2afa7fa78b4df595fa36e363), [`afc6404`](https://github.com/glypse/webgpu-nodes/commit/afc64041dc41e51a764ebd2f316155e3ac450564), [`6f8e7da`](https://github.com/glypse/webgpu-nodes/commit/6f8e7da24975e49718775b4dc21b2d80ffe973cb), [`ac6dfba`](https://github.com/glypse/webgpu-nodes/commit/ac6dfbacb9e884ab2f4d63ebd64b49a66b55cfce), [`9b6b696`](https://github.com/glypse/webgpu-nodes/commit/9b6b6969976dae87ead0cb0fb4241b425ea9d294), [`bf5fa74`](https://github.com/glypse/webgpu-nodes/commit/bf5fa746ccf459dd3a66cbcc8855120e1f7ab3c2), [`5e12790`](https://github.com/glypse/webgpu-nodes/commit/5e1279062c4502f0f49a21f33a4065dbae9d48e6), [`9b6997f`](https://github.com/glypse/webgpu-nodes/commit/9b6997f8a0d1944d74d2506a29919acf4734e3bf), [`974150f`](https://github.com/glypse/webgpu-nodes/commit/974150f4fb0572662c893ad505ce200a8284979c), [`307febd`](https://github.com/glypse/webgpu-nodes/commit/307febdef1fb23c3a903272af8a9df4539dee3b8), [`c470e29`](https://github.com/glypse/webgpu-nodes/commit/c470e29c1e6a4ae6ac2b6f458182fb7386d1e0b0), [`f9a3e13`](https://github.com/glypse/webgpu-nodes/commit/f9a3e137f00d544b60d0d4d2877ed2cbb40c5bae), [`c8214cf`](https://github.com/glypse/webgpu-nodes/commit/c8214cfb74057e5b3814b12cac44a94ca3fa1abc), [`81f5bc5`](https://github.com/glypse/webgpu-nodes/commit/81f5bc5151afa16ecb76b80fe2aa7fd3055a95e0), [`7edbc61`](https://github.com/glypse/webgpu-nodes/commit/7edbc6160b860a938085a88f7fef17eac581a79e), [`9230ee4`](https://github.com/glypse/webgpu-nodes/commit/9230ee40e80010b310e767ad0061409c1f6ebaea), [`aac1fa0`](https://github.com/glypse/webgpu-nodes/commit/aac1fa0b3a65245b49acf733b6b8408766ffe7e2), [`61c9241`](https://github.com/glypse/webgpu-nodes/commit/61c92416a8b3d122e6cf06eac1ba913998805bc8), [`9ba94b2`](https://github.com/glypse/webgpu-nodes/commit/9ba94b25e54bca5d07caec06ea03db3f04b7ec4d), [`d7ff179`](https://github.com/glypse/webgpu-nodes/commit/d7ff17961b9df4037c2986e17327479347a33b36), [`12a26de`](https://github.com/glypse/webgpu-nodes/commit/12a26dea14e080e3e18a0e7a871e1c4741a1f0de), [`bb9eadf`](https://github.com/glypse/webgpu-nodes/commit/bb9eadfec3990c4e3f78f9fdf01de7b3660b3c5e), [`9fb5f92`](https://github.com/glypse/webgpu-nodes/commit/9fb5f9295e552cfd89c5102b7e6914275ba19e12), [`064740d`](https://github.com/glypse/webgpu-nodes/commit/064740db44236334a0daef0ecbbde040abe66715), [`0c438c8`](https://github.com/glypse/webgpu-nodes/commit/0c438c8949d44db3b8304a3e13f36622737f17e7)]:
  - $editor@0.6.0
  - $core@0.1.0
  - $theme@0.3.0

## 0.0.8

### Patch Changes

- Updated dependencies [[`c00aea5`](https://github.com/glypse/webgpu-nodes/commit/c00aea544501765adf8a5ae79b8f51a9cdb58ba8), [`13d0db1`](https://github.com/glypse/webgpu-nodes/commit/13d0db140f3432e86f4b3117a01063a335974073), [`c00aea5`](https://github.com/glypse/webgpu-nodes/commit/c00aea544501765adf8a5ae79b8f51a9cdb58ba8), [`c572fc2`](https://github.com/glypse/webgpu-nodes/commit/c572fc2a24d00d5296366e3b84e593a88352ddb9), [`0cf6666`](https://github.com/glypse/webgpu-nodes/commit/0cf66665844b350ef79d63395f5ecad6f0ca1695), [`22da746`](https://github.com/glypse/webgpu-nodes/commit/22da7467fcce00126008f179b420572ce296ffb1)]:
  - $editor@0.5.0
  - $theme@0.2.0

## 0.0.7

### Patch Changes

- Updated dependencies [[`1eec8b5`](https://github.com/glypse/webgpu-nodes/commit/1eec8b54e65b2055225b361cd1b44df3f6f87e17)]:
  - $editor@0.4.0

## 0.0.6

### Patch Changes

- Updated dependencies [[`f5ce997`](https://github.com/glypse/webgpu-nodes/commit/f5ce997bc8c06ce9214ad94742a3abc7dc1ee70c), [`f5ce997`](https://github.com/glypse/webgpu-nodes/commit/f5ce997bc8c06ce9214ad94742a3abc7dc1ee70c)]:
  - $theme@0.1.1
  - $editor@0.3.1

## 0.0.5

### Patch Changes

- Updated dependencies [[`879a21f`](https://github.com/glypse/webgpu-nodes/commit/879a21f8a19beea24c482b346204fa19465e4bfe), [`879a21f`](https://github.com/glypse/webgpu-nodes/commit/879a21f8a19beea24c482b346204fa19465e4bfe)]:
  - $editor@0.3.0

## 0.0.4

### Patch Changes

- Updated dependencies [[`140b2c5`](https://github.com/glypse/webgpu-nodes/commit/140b2c5e54aef15fdd5b776454396f8939223f2e), [`67eba90`](https://github.com/glypse/webgpu-nodes/commit/67eba9009ee92e36299d9df6e186f62a394cf032), [`0de7520`](https://github.com/glypse/webgpu-nodes/commit/0de75206fc3943c38d69319bb2cd68365ac4d017), [`cf39841`](https://github.com/glypse/webgpu-nodes/commit/cf39841f30eeef3b7d271c5f237cfb44aa54c9c4), [`c97bea8`](https://github.com/glypse/webgpu-nodes/commit/c97bea8bd1d8940b0224ef11c71649ebd09aba90)]:
  - $editor@0.2.0

## 0.0.3

### Patch Changes

- Updated dependencies [[`0eb7f3d`](https://github.com/glypse/webgpu-nodes/commit/0eb7f3dca7e04d94818ad7c65c29d41f096f2168), [`9f2086c`](https://github.com/glypse/webgpu-nodes/commit/9f2086c1fcdea6dd47fea1b64a7b3b819be28db6)]:
  - $editor@0.1.0

## 0.0.2

### Patch Changes

- [`232d47d`](https://github.com/glypse/webgpu-nodes/commit/232d47dd879b38a89415a71575b03f1f8af83ea2) Thanks [@glypse](https://github.com/glypse)! - fix(web): handle inputs of combineVec4f via connected handle instead of via connection order
