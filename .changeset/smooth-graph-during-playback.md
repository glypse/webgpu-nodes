---
"$runtime": patch
"$editor": patch
---

The node graph stays smooth while the preview plays, however heavy the graph is: the preview now draws no faster than the GPU finishes its frames, rather than queueing work the whole window then waits behind, so a heavy preview only lowers its own frame rate. Videos cost less to play, with frames read straight from the decoder and only when they're drawn, and many playing at once keep moving instead of nearly freezing when decoding can't keep up.
