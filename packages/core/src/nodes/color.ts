import { DISPLAY_P3_FIELD, FRAME_VAR } from "../codegen/program";
import { DISPLAY_P3_TO_SRGB, SRGB_TO_DISPLAY_P3, wgslMat3 } from "../color/display";
import type { NodeDescriptor } from "../types";

const CLIP_FN = "clip_to_display_gamut";
const CLIP_SOURCE = `fn ${CLIP_FN}(c: vec3f) -> vec3f {
	if (${FRAME_VAR}.${DISPLAY_P3_FIELD} == 0u) {
		return clamp(c, vec3f(0.0), vec3f(1.0));
	}
	let p3 = clamp(${wgslMat3(SRGB_TO_DISPLAY_P3)} * c, vec3f(0.0), vec3f(1.0));
	return ${wgslMat3(DISPLAY_P3_TO_SRGB)} * p3;
}`;

/**
 * Clamps a linear sRGB colour to the gamut of what's drawn: sRGB, or Display
 * P3 (where it may keep components outside [0, 1]), per draw rather than per
 * project, so an sRGB export of a Display P3 project fits sRGB.
 */
export const displayGamutClipNode: NodeDescriptor = {
	type: "display-gamut-clip",
	label: "Clip to Display Gamut",
	aliases: ["Gamut Clip", "Clip Color", "Display P3", "sRGB Gamut", "Color Space Conversion"],
	category: "color",
	inputs: [{ id: "color", label: "color", types: ["vec3f"] }],
	outputs: [{ id: "color", label: "color", type: "vec3f" }],
	defaultData: { values: { color: 0 } },
	wgsl: (ctx) => [
		`let ${ctx.varName} = ${ctx.fn(CLIP_FN, CLIP_SOURCE)}(${ctx.promoteInput("color")});`,
	],
};
