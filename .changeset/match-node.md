---
"$editor": minor
---

Add a Match node, picking a value by the variant of the enum linked to it: it has one input per variant, so adding, renaming, reordering or removing a variant updates its cases and keeps their links. When a group node sets the enum's value, only the picked case is computed.
