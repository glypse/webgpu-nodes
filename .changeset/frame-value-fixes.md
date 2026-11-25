---
"$core": patch
"$runtime": patch
---

Groups inside repeat zones give the right frame values, sizes that depend on other textures' sizes are right, and numbers too large for an integer are clamped as they are on the GPU.
