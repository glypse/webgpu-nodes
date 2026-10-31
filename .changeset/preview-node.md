---
"$core": minor
"$editor": minor
"$web": minor
---

Preview a node with Ctrl/⌘+Shift+click, Preview in its right-click menu, or Edit → Preview selected node: its output is linked straight to the Output node, replacing what was linked there; previewing it again shows its next output. Inside a group, each group on the way gets a Viewer output carrying the preview up to the Output node; Viewer outputs the next preview doesn't use are removed, so they never pile up. Previews can't be made inside locked groups.
