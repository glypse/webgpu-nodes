# $runtime

Draws the `ShaderProgram`s [$core](../core/) generates with WebGPU: on a canvas, or read back as pixels for exports. A program draws a linear colour into a float texture, then a presentation pass encodes it in the colour space asked for (sRGB or Display P3). `Player` keeps project time, at a fixed frame rate or in real time.

```ts
import { buildProgram, generateShader } from "$core";
import { CanvasTarget, Player, Renderer } from "$runtime";

const renderer = await Renderer.create();
const { shader, uniforms } = generateShader(graph);
const program = await renderer.compile(buildProgram(shader, uniforms));
program.setUniforms(uniforms);

const target = new CanvasTarget(renderer, canvas);
target.configure({ width: 1920, height: 1080 }, "display-p3");
const player = new Player({ fps: 60, realtime: false }, (frame) => target.render(program, frame));
player.play();
```
