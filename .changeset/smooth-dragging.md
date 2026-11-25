---
"$core": patch
"$editor": patch
---

Moving, resizing and selecting nodes, scrubbing their values, and putting them in or out of frames no longer recompute what every link does with textures and frame values, so the editor stays smooth in large graphs.
