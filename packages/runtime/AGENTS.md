# runtime

Draws the `ShaderProgram`s that core generates, using WebGPU: `Renderer`, `CanvasTarget`, and pixel readback for exports. Also keeps project time (`Clock`, `Player`).

No Svelte.

Core owns the program's WGSL and its uniform layout (`codegen/program.ts`). This package only follows that layout, so don't duplicate its definitions here.
