import * as v from "valibot";

import { FiniteSchema, IdSchema, listOf, MAX_GROUP_DEPTH } from "../graph/limits";
import type { Screen } from "./screen";

export const ViewportSchema = v.object({
	x: FiniteSchema,
	y: FiniteSchema,
	zoom: v.pipe(FiniteSchema, v.gtValue(0)),
});

const FractionSchema = v.pipe(FiniteSchema, v.minValue(0), v.maxValue(1));

const EditorSchema = v.variant("type", [
	v.object({
		type: v.literal("graph"),
		path: v.pipe(v.array(IdSchema), v.maxLength(MAX_GROUP_DEPTH)),
		viewport: v.optional(ViewportSchema),
	}),
	v.object({ type: v.literal("preview") }),
	v.object({ type: v.literal("timeline") }),
	v.object({ type: v.literal("assets") }),
]);

export const ScreenSchema = v.pipe(
	v.object({
		areas: v.pipe(
			listOf(
				v.object({
					id: IdSchema,
					rect: v.object({
						left: FractionSchema,
						top: FractionSchema,
						right: FractionSchema,
						bottom: FractionSchema,
					}),
					editor: EditorSchema,
				}),
			),
			v.minLength(1),
		),
	}),
	v.check(
		(screen: Screen) =>
			screen.areas.every((a) => a.rect.right > a.rect.left && a.rect.bottom > a.rect.top),
		"Every area needs a size.",
	),
	v.check(
		(screen: Screen) => new Set(screen.areas.map((a) => a.id)).size === screen.areas.length,
		"Every area needs an id of its own.",
	),
);
