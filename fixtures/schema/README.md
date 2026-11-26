# Saved format schema

`project.schema.json` and `groups.schema.json` are the JSON Schema (draft 2020-12) of a saved project (`GraphProjectSchema`) and of an exported groups file (`GroupsFileSchema`), generated from the valibot schemas in `packages/core/src/graph/schema.ts`. The Rust port validates and deserialises against them.

Regenerate after changing those schemas:

```bash
cd packages/core && bun run schema:build
```

`packages/core/scripts/schema.test.ts` fails when the files are stale and checks that every scene in `packages/core/src/scenes` is a valid project.

## Rules the JSON Schema can't express

Valibot's own checks, and what the converter can't carry:

- Custom WGSL sockets (`data.sockets`): every input and output label is a WGSL name (`[A-Za-z_][A-Za-z0-9_]*`, not `_`, no `__` prefix, not a reserved word, not `vecN`/`matN` type names), and the labels are unique across inputs and outputs together.
- Ramp (`data.ramp`): every stop id matches `stop-` followed by 1 to 9 digits, and no two stops share an id.
- Project `definitions`: at most 2000 entries.
- Layout (`layout.areas`): every area has `right > left` and `bottom > top`, and area ids are unique.
- Asset (`assets`, and the groups file's `assets`): the mime type is `image/…` (or `video/…`), matches `^(image|video)/[a-z0-9][a-z0-9.+-]*$`, and is not `image/svg+xml`; the kind follows the mime type. The `file` is `assets/images/<id><ext>` for images or `assets/videos/<id><ext>` for videos, where `<ext>` is empty or a lowercase extension of 1 to 8 letters or digits.
- String lengths (`maxLength` in the schema) are JavaScript UTF-16 lengths in valibot but code point counts in JSON Schema. Rust should count UTF-16 units to match valibot.
- Finite numbers: valibot rejects values such as `1e999` that parse to infinity. Rust should reject them after parsing.
- Graph-level checks (`projectIssues` in `packages/core/src/graph/validate.ts`, such as a missing root) are not in the schema at all.

## Mapping to serde

- `InputValue` (`values`, `defaults`): a number, a boolean, or an object with optional `x`, `y`, `z`, `w` (each a number or boolean) and no other keys. `#[serde(untagged)]`, told apart by JSON kind.
- Socket `type` on group `inputs` and `outputs` and on zone `items`: a socket type string, `{"variable": id}` or `{"inferred": true}`, each object closed. `#[serde(untagged)]`, told apart by kind and then by key. Custom WGSL sockets take the string form only.
- Node `data`: one closed struct of optional fields, where unknown keys are rejected. Which fields apply depends on the node `type`, which the schema doesn't tie to fields. `#[serde(deny_unknown_fields)]` with `Option` fields, and the per-type rules belong in core.
- `settings`: absent means the schema's `default` (the values of `defaultSettings`). `#[serde(default)]` on the field.
- Asset `kind` and screen editor `type`: tagged by that key. `#[serde(tag = "kind")]` and `#[serde(tag = "type")]`.
- `NodeWidget` (`kind`): tagged by `kind`, `#[serde(tag = "kind")]`. It appears in library entries' `widget` only, not in these two files.
