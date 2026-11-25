// Every standard-library group described in TypeScript: `bun run stdlib:build`
// builds them, and the library's files must match them (see groups.test.ts).
import type { GroupSpec } from "../builder";
import blur from "./blur";
import color from "./color";
import coordinates from "./coordinates";
import motion from "./motion";
import noise from "./noise";
import texture from "./texture/fit-uv";
import vector from "./vector";

export default [
	...coordinates,
	...color,
	...vector,
	...noise,
	...texture,
	...blur,
	...motion,
] satisfies GroupSpec[];
