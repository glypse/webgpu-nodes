---
"$core": minor
"$editor": minor
---

Gaussian Blur and Box Blur have a Separable checkbox: unticked, they blur both axes at once, which keeps a radius varying across the image free of streaks, at a far greater cost. Past a radius of 64 pixels their taps spread out, so thin details can show as faint patterns.
