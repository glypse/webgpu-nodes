---
"$core": patch
---

A group input passed on to a nested group's input that computes its own default (e.g. the UV) now falls back to that default when unlinked, and shows as "(default)", instead of passing its stored value on.
