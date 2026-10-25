---
"$editor": minor
---

Add a Fallback node, and an Aspect UV group to the standard library. Fallback uses its value when one is passed and its default otherwise; inside a group, an input whose socket is left unlinked counts as not passed, so the group can compute its own default. Aspect UV scales coordinates to the canvas aspect ratio, with a Contain (fit), Cover (fill) or Stretch mode picked from a dropdown (or driven by a value), only the picked one being computed; left unlinked, its coordinates fall back to the fragment UV.
