import * as v from "valibot";

import type { Screen } from "./screen";

export const ViewportSchema = v.object({
	x: v.number(),
	y: v.number(),
	zoom: v.number(),
});

const FractionSchema = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

const EditorSchema = v.variant("type", [
	v.object({
		type: v.literal("graph"),
		path: v.array(v.string()),
		viewport: v.optional(ViewportSchema),
	}),
	v.object({ type: v.literal("preview") }),
	v.object({ type: v.literal("timeline") }),
]);

export const ScreenSchema = v.pipe(
	v.object({
		areas: v.pipe(
			v.array(
				v.object({
					id: v.string(),
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
);
