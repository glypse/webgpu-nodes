---
"$core": minor
"$editor": minor
"$web": minor
---

Files can no longer harm a project. A project or groups bundle is checked in full before anything changes: one that's damaged, crafted or too large is refused with a message saying why, and the project stays as it was. Importing groups never replaces what's there, a group differing from one of the project's coming in as a copy, and files that aren't what their bundle says are left out. Exported groups now keep their inputs, outputs and defaults, and Custom WGSL nodes with several outputs compile.
