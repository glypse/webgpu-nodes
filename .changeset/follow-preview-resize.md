---
"$runtime": patch
"$editor": patch
"$web": patch
---

With the canvas following the preview, resizing the preview area redraws the shader at the new size on every frame instead of stretching the last frame until the resize ends, and the canvas no longer drops to 0 × 0 while the preview area is hidden, squeezed under its header or closed.
