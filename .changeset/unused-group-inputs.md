---
"$editor": minor
---

Group nodes hide the inputs their enum choices leave unused: an unlinked input only feeding cases a Match node doesn't pick (in the group or groups inside it) disappears until a variant using it is picked. Inputs no variant uses, like one just added, stay shown. This way each variant has its own inputs: the group settings sheet tells which variants use each input, and inputs never shown together may share a label.
