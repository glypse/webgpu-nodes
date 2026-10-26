---
"$editor": minor
---

Add repeat zones (loops), like Blender's geometry-nodes repeat zone: a Repeat Input / Repeat Output pair carrying typed state items across iterations, with an iteration index, a dynamic iteration count clamped by a per-zone safety cap, and nested zones. Nodes linked from the Repeat Input run once per iteration inside a bubble drawn around the zone, while loop invariants stay outside and are computed once. Links leaving a zone are drawn red and ignored, connections that would break zone rules or close a cycle are refused, zone nodes are deleted and grouped as a pair, and dropping a link on a zone's "new item" socket creates a state item of the right type.
