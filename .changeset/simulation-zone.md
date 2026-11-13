---
"$core": minor
"$runtime": minor
"$editor": minor
"$theme": minor
---

Add a Simulation Zone, after Blender's: the nodes in it compute each frame's state from the previous frame's, per pixel. Its state items keep any value type exactly, and a Texture item keeps an image of the previous frame, which Sample Texture can read anywhere (trails, feedback, reaction-diffusion). The Simulation Input gives the Delta Time since the previous frame, and the Simulation Output's Skip keeps the previous state. A simulation starts from its initial values on the first frame and whenever time goes back; redrawing a frame (e.g. editing a value while paused) computes it again from the same state, and editing the graph keeps the state. Each instance of a group holding a simulation keeps its own, and a simulation can't be inside another zone. Video exports starting after the first frame simulate the frames before it first.
