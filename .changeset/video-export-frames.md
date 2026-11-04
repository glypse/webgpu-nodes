---
"$runtime": patch
"$web": patch
---

Exported videos and captured frames show the right frame of the videos they play: the preview redrawing during an export could put the frame it was paused on in their place, often every other frame. Exports with videos are also much faster, no longer decoding the preview's frame between theirs.
