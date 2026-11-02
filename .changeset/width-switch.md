---
"$core": minor
"$editor": minor
---

New Width Switch node: picks one of four cases (Scalar, Vector 2, Vector 3, Vector 4) by how many components a value's type has, known while compiling. Only the picked case is computed and its type is the result's, so each case can have its own width. It replaces Match on Component Count, whose output is now a plain number. The standard library's noises and vector helpers use it: OpenSimplex's gradients and lattice positions are now computed at their own width rather than as four components.
