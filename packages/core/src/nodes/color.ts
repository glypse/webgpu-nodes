import {
	type NodeData,
	type NodeDescriptor,
	type NodeInputDef,
	type NodeSetting,
	settingValue,
	type WgslType,
} from "../types";

export type ColorMode = "rgb" | "hsv" | "oklch";

/**
 * What the three components are. RGB is linear (what the shader computes
 * with); HSV is of the sRGB-encoded colour, hue in [0, 1] (as Blender); OKLch
 * has its hue in degrees.
 */
export const COLOR_MODE_SETTING: NodeSetting = {
	key: "mode",
	label: "Mode",
	options: [
		{ value: "rgb", label: "RGB" },
		{ value: "hsv", label: "HSV" },
		{ value: "oklch", label: "OKLch" },
	],
};

/**
 * Input ids of the three components, the same in every mode: links and
 * values stay on their socket when the mode changes, as in Blender.
 */
export const COLOR_COMPONENTS = ["c1", "c2", "c3"] as const;
export const COLOR_ALPHA = "a";

const COMPONENT_LABELS: Record<ColorMode, readonly [string, string, string]> = {
	rgb: ["Red", "Green", "Blue"],
	hsv: ["Hue", "Saturation", "Value"],
	oklch: ["Lightness", "Chroma", "Hue"],
};

export function colorMode(data: NodeData): ColorMode {
	const mode = settingValue(data, COLOR_MODE_SETTING);
	return mode === "rgb" || mode === "oklch" ? mode : "hsv";
}

function colorInputs(type: WgslType, data: NodeData): NodeInputDef[] {
	const labels = COMPONENT_LABELS[colorMode(data)];
	const inputs: NodeInputDef[] = COLOR_COMPONENTS.map((id, i) => ({
		id,
		label: labels[i] ?? id,
		types: ["f32"],
	}));
	if (type === "vec4f") inputs.push({ id: COLOR_ALPHA, label: "Alpha", types: ["f32"] });
	return inputs;
}

/** Statements defining `${v}_rgb`, the linear RGB of components `x`, `y`, `z`. */
function linearRgb(mode: ColorMode, v: string, x: string, y: string, z: string): string[] {
	switch (mode) {
		case "rgb":
			return [`let ${v}_rgb = vec3f(${x}, ${y}, ${z});`];
		case "hsv":
			return [
				`let ${v}_hsv = vec3f(${x}, ${y}, ${z});`,
				`let ${v}_hue = clamp(abs(fract(${v}_hsv.x + vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));`,
				`let ${v}_srgb = max(${v}_hsv.z * mix(vec3f(1.0), ${v}_hue, ${v}_hsv.y), vec3f(0.0));`,
				`let ${v}_rgb = select(pow((${v}_srgb + 0.055) / 1.055, vec3f(2.4)), ${v}_srgb / 12.92, ${v}_srgb <= vec3f(0.04045));`,
			];
		case "oklch":
			// Björn Ottosson's OKLab to linear sRGB, components below 0 clipped.
			return [
				`let ${v}_angle = radians(${z});`,
				`let ${v}_lab = vec3f(${x}, ${y} * cos(${v}_angle), ${y} * sin(${v}_angle));`,
				`let ${v}_lms = vec3f(dot(${v}_lab, vec3f(1.0, 0.3963377774, 0.2158037573)), dot(${v}_lab, vec3f(1.0, -0.1055613458, -0.0638541728)), dot(${v}_lab, vec3f(1.0, -0.0894841775, -1.291485548)));`,
				`let ${v}_cubed = ${v}_lms * ${v}_lms * ${v}_lms;`,
				`let ${v}_rgb = max(vec3f(dot(${v}_cubed, vec3f(4.0767416621, -3.3077115913, 0.2309699292)), dot(${v}_cubed, vec3f(-1.2684380046, 2.6097574011, -0.3413193965)), dot(${v}_cubed, vec3f(-0.0041960863, -0.7034186147, 1.707614701))), vec3f(0.0));`,
			];
	}
}

/**
 * A colour from three components in a chosen colour model, edited on the
 * node with a colour wheel. Declare builds the same vectors from plain
 * numbers.
 */
export const colorNode: NodeDescriptor = {
	type: "color",
	label: "Color",
	aliases: [
		"RGB",
		"RGBA",
		"Combine Color",
		"Combine RGB",
		"Combine HSV",
		"Color Constant",
		"Solid Color",
	],
	category: "color",
	inputs: colorInputs("vec4f", {}),
	outputs: [{ id: "color", label: "color", type: "vec3f" }],
	// A light grey: 0.8 in linear RGB.
	defaultData: { values: { c1: 0, c2: 0, c3: 0.906, a: 1 }, settings: { mode: "hsv" } },
	settings: [COLOR_MODE_SETTING],
	typeFamily: { key: "color", types: ["vec3f", "vec4f"] },
	resolveInputs: colorInputs,
	widget: { kind: "color" },
	wgsl: (ctx) => {
		const [x = "0.0", y = "0.0", z = "0.0"] = COLOR_COMPONENTS.map((id) =>
			ctx.promoteInput(id),
		);
		const v = ctx.varName;
		const rgb = linearRgb(colorMode(ctx.data), v, x, y, z);
		const value =
			ctx.outputType === "vec4f"
				? `vec4f(${v}_rgb, ${ctx.promoteInput(COLOR_ALPHA)})`
				: `${v}_rgb`;
		return [...rgb, `let ${v} = ${value};`];
	},
};
