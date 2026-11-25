---
"$core": patch
"$editor": patch
---

Moving, resizing and selecting nodes and links, scrubbing values, and putting nodes in or out of frames no longer recompute what every link does with textures and frame values, so the editor stays smooth in large graphs. Edits that do change the graph recompute it about twice as fast.
