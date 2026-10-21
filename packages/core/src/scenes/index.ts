import * as v from "valibot";

import type { GraphProject } from "../graph/document";
import { GraphProjectSchema } from "../graph/schema";
import debug from "./debug.json";
import defaultJson from "./default.json";

/** The project the editor opens with. */
export const defaultScene: GraphProject = v.parse(GraphProjectSchema, defaultJson);

/** A project holding only the Output node. */
export const debugScene: GraphProject = v.parse(GraphProjectSchema, debug);
