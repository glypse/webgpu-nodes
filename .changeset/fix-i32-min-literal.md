---
"$core": patch
---

Fix an i32 input set to -2147483648 being drawn as -2147483647, which threw off integer maths at the lower limit (abs, negate, wrapping sums, division and remainder).
