---
"$core $editor": minor
---

Dropping a link on empty space opens the add menu with only the nodes that can take it, offering nodes whose type is picked (Declare) in the type that fits it: "Declare vec3f" to feed a vec3f input, or "Declare vec2f" … "Declare vec4f" to combine a dragged f32 into a vector. The picked node is created at the drop point and linked (to the best-matching input or output, or a repeat zone's new state item).
