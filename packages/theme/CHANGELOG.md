# $theme

## 0.3.0

### Minor Changes

- [#32](https://github.com/glypse/webgpu-nodes/pull/32) [`98c7517`](https://github.com/glypse/webgpu-nodes/commit/98c7517fb1265f570d01f0a04b67f847a2d78d9b) Thanks [@glypse](https://github.com/glypse)! - Add a colour input control: it turns a vec3f / vec4f input (e.g. the Output node's) into a swatch opening a compact colour picker: RGB, HSV or OKLch fields, alpha, hex and a screen eyedropper where the browser has one, picked on a hue / saturation wheel and value ramp, or in OKLch on the Color node's gamut-aware wheel and lightness gauge. Colours are stored as linear RGB; hex, HSV and swatches are shown sRGB-encoded.

### Patch Changes

- Updated dependencies [[`f6eb82d`](https://github.com/glypse/webgpu-nodes/commit/f6eb82d32c87b5a51e000bc091393d15150f5f53), [`98c7517`](https://github.com/glypse/webgpu-nodes/commit/98c7517fb1265f570d01f0a04b67f847a2d78d9b), [`6f8e7da`](https://github.com/glypse/webgpu-nodes/commit/6f8e7da24975e49718775b4dc21b2d80ffe973cb), [`81f5bc5`](https://github.com/glypse/webgpu-nodes/commit/81f5bc5151afa16ecb76b80fe2aa7fd3055a95e0)]:
  - $core@0.1.0

## 0.2.0

### Minor Changes

- [#30](https://github.com/glypse/webgpu-nodes/pull/30) [`13d0db1`](https://github.com/glypse/webgpu-nodes/commit/13d0db140f3432e86f4b3117a01063a335974073) Thanks [@glypse](https://github.com/glypse)! - Float vectors now display a scrubbable input

## 0.1.1

### Patch Changes

- [#24](https://github.com/glypse/webgpu-nodes/pull/24) [`f5ce997`](https://github.com/glypse/webgpu-nodes/commit/f5ce997bc8c06ce9214ad94742a3abc7dc1ee70c) Thanks [@glypse](https://github.com/glypse)! - Easier input of f32 values with a scrubbable number input
