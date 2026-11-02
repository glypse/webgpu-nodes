---
"$core": minor
"$editor": minor
---

Repeat zone state items can be inferred: such an item takes the type of the initial value linked to the Repeat Input (f32 while unlinked), and its next value is converted to that type, so inside a generic group a loop carries values as wide as each group node's. New zones and items made by dropping a link on a zone's "new item" socket are inferred; one made from a link to anything but its initial value keeps the type at the link's other end until an initial value is linked. Pick Inferred in the zone's item type menu to switch an item back; inferred sockets show their type followed by "(inferred)".
