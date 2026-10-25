---
"$editor": minor
---

Group nodes hide the inputs their enum choices leave unused: an unlinked input only feeding cases a Match node doesn't pick (in the group or groups inside it) disappears until a variant using it is picked. Inputs no variant uses, like one just added, stay shown. Group inputs can also be named after the variant of an enum input, e.g. Red, Green and Blue in RGB but Hue, Saturation and Value in HSV.
