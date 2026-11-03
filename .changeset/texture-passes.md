---
"$core": minor
"$runtime": minor
"$editor": minor
"$web": minor
---

Link any value to a Texture input: it's rendered to a canvas-sized texture first, in a pass of its own (a "pass" tag on the link tells), so nodes can read its neighbouring pixels. Group outputs of type Texture fed by a value render it, so groups can pass textures on. Links that can't be rendered (a value computed inside a repeat zone) or switch textures by a case only known per pixel are drawn red, with why. Add Gaussian Blur and Box Blur groups (Texture › Blur), with a radius per axis as a fraction of the canvas' height and an edge mode, built from ordinary nodes you can open and change.
