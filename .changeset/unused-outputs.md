---
"$core": minor
---

Shaders only compute what's used: a group node's unlinked outputs, and a repeat zone's state items nothing reads, are left out of the compiled shader.
