---
"$core": patch
"$editor": patch
---

Links to sockets that disappear when types change (a vector's Z after it becomes a vec2f) are no longer deleted: they're hidden and ignored until the socket is back. Editing a generic group entered through one instance no longer removes links another instance uses, and an instance whose types lack a socket compiles without it.
