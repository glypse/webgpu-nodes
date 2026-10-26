---
"$editor": minor
---

Give each variant of a group's enum input its own inputs: in the group settings sheet, every variant lists its inputs and has its own Add input button, and group nodes show only the inputs of the variants they're on (all of them while the enum is linked to a value computed in the shader). Inputs of the other variants hide even when linked: their links are kept, undrawn, and come back with the variant. Enums can nest under a variant. Removing a variant or an enum removes its inputs, and inputs never shown together may share a label.
