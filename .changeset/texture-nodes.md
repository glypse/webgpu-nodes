---
"$core": minor
"$runtime": minor
"$editor": minor
"$web": minor
---

Add a Texture socket type and nodes reading images and videos: Image and Video nodes show a project asset (picked on the node, or imported from it), Video plays it from a start time at a speed, then loops, holds its last frame or turns transparent; Sample Texture reads a texture at coordinates (the pixel's by default) with linear or closest interpolation and clamp, repeat, mirror or transparent edges; Texture Size gives a texture's size in pixels and the step between them. A texture linked to a colour is sampled at the pixel, shown by a "sample" tag on the link. Group inputs and outputs, reroutes and switches whose case is known while compiling can carry textures; zones can't. Images and videos are decoded to linear colour, frame-accurately in video exports, and a node whose file is missing warns and reads a transparent image.
