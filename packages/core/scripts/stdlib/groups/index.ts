// Every standard-library group described in TypeScript: `bun run stdlib:build`
// builds them, and the library's files must match them (see groups.test.ts).
import type { GroupSpec } from "../builder";
import color from "./color";
import coordinates from "./coordinates";
import noise from "./noise";
import vector from "./vector";

export default [...coordinates, ...color, ...vector, ...noise] satisfies GroupSpec[];
