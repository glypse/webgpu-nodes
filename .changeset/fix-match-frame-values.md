---
"$core": patch
---

Fix a Match node picking its first case whenever its result was computed once per frame rather than per pixel: Aspect UV's Cover mode drew nothing.
