---
"$editor": minor
---

Let a group's sockets share types. In the group settings sheet, add shared types (T, U…), each allowing a set of types (Float, Integer, Any number…), and give sockets one from their type menu ("New shared type" makes one from a socket). On each group node, sockets sharing a type take the same one, inferred from what's linked to them like a built-in node's, and each shared type gets a picker to force it. Different shared types are inferred independently, and a group entered through a group node shows its types inside.
