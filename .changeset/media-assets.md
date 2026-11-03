---
"$core": minor
"$editor": minor
"$web": minor
---

Import images and videos into a project, from File › Import media… or a new Assets area (one of the editors an area can show): drop files on it or import them, see their thumbnails, size and duration, rename them (double-click), replace their file or delete them, with undo. Projects now save as a `.wgnodes` bundle holding the project and its media files, and Upload opens only these (JSON projects are no longer read). Exporting a group now downloads one `.wggroups` bundle with the user groups it nests and the media they use; Import groups reads these bundles, several at once, reusing media the project already has.
