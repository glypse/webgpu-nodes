---
"$core": minor
"$editor": minor
"$web": minor
---

Add a Custom WGSL node, for anything nodes can't express yet: write WGSL in the code editor on the node (Tab indents), reading its inputs by name and setting its outputs, which are zero unless the code sets them. The plug button edits its sockets: add, remove, reorder, rename (names must be WGSL identifiers, not keywords or types, and not taken) and retype them; links that no longer fit are removed. The shader recompiles once typing pauses, and mistakes show in the preview's error overlay with the offending line.
