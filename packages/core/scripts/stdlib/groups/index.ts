// Every standard-library group described in TypeScript: `bun run stdlib:build`
// builds them, and the library's files must match them (see groups.test.ts).
import type { GroupSpec } from "../builder";
import voronoi from "./voronoi";

export default [...voronoi] satisfies GroupSpec[];
