---
"$runtime": patch
---

Playback at a fixed frame rate matching the display's refresh rate no longer skips draws: it used to drop a frame (then jump two) whenever an animation frame came slightly early, which happened often in heavy scenes, making it noticeably choppier than real time at the same rate.
