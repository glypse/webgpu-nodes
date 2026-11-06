---
"$core": minor
"$editor": minor
---

Gaussian Blur and Box Blur have a Direction checkbox: ticked, it shows an Angle (in degrees) and blurs in a single pass along it. Box Blur has Iterations, from 1 to 8, repeating the blur for a smoother result. Blurs wider than about 511 pixels no longer lose part of their kernel, and a blur whose radius varies across the image no longer steps where its kernel gains a tap.
