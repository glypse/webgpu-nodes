import { LINEAR_RGB_TO_LMS, LMS_TO_LINEAR_RGB, LMS_TO_OKLAB, OKLAB_TO_LMS } from "../color/convert";
import { wgslMat3 } from "../color/display";
import {
	DEFAULT_RAMP,
	evaluateRamp,
	HUE_DECREASING,
	HUE_INCREASING,
	HUE_LONGER,
	HUE_SHORTER,
	RAMP_ACHROMATIC,
	RAMP_B_SPLINE,
	RAMP_CARDINAL,
	RAMP_CARDINAL_TENSION,
	RAMP_CONSTANT,
	RAMP_EASE,
	RAMP_HSV,
	RAMP_HUES,
	RAMP_INTERPOLATIONS,
	RAMP_LINEAR,
	RAMP_OKLCH,
	RAMP_RGB,
	RAMP_SMOOTH,
	RAMP_SPACES,
	type RampStop,
	sortedRampStops,
} from "../ramp";
import {
	knownEnum,
	type NodeData,
	type NodeDescriptor,
	type NodeInputDef,
	typeComponents,
	type VectorValue,
	type WgslCtx,
} from "../types";
import { coerce } from "./cpu";

export const COLOR_RAMP = "color-ramp";
export const RAMP_FACTOR = "factor";
export const RAMP_INTERPOLATION = "interpolation";
export const RAMP_SPACE = "space";
export const RAMP_HUE = "hue";
/** The type family of the stops' colours, which is the output's type. */
const COLOR_FAMILY = "color";

export function colorRampStops(data: NodeData): RampStop[] {
	return sortedRampStops(data.ramp);
}

/**
 * The inputs a Color Ramp doesn't show: its hue interpolation while its
 * colour space is RGB (picked on the node), which has no hue.
 */
export function colorRampHiddenInputs(data: NodeData, linked: ReadonlySet<string>): Set<string> {
	const space = data.values?.[RAMP_SPACE] ?? RAMP_RGB;
	const rgb = !linked.has(RAMP_SPACE) && Number(space) === RAMP_RGB;
	return new Set(rgb ? [RAMP_HUE] : []);
}

const opaque = (n: number): VectorValue => ({ x: n, y: n, z: n, w: 1 });
const DEFAULT_COLORS: Readonly<Record<string, VectorValue>> = Object.fromEntries(
	DEFAULT_RAMP.map((stop) => [stop.id, opaque(stop.position)]),
);

const TAU = (2 * Math.PI).toFixed(9);

const ENCODE_FN = "color_ramp_encode";
const ENCODE_SOURCE = `fn ${ENCODE_FN}(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, 12.92 * x, x <= vec3f(0.0031308));
}`;

const DECODE_FN = "color_ramp_decode";
const DECODE_SOURCE = `fn ${DECODE_FN}(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return select(pow((x + 0.055) / 1.055, vec3f(2.4)), x / 12.92, x <= vec3f(0.04045));
}`;

const TO_HSV_FN = "color_ramp_to_hsv";
const TO_HSV_SOURCE = `fn ${TO_HSV_FN}(c: vec4f) -> vec4f {
  let e = ${ENCODE_FN}(c.rgb);
  let high = max(e.r, max(e.g, e.b));
  let delta = high - min(e.r, min(e.g, e.b));
  var h = 0.0;
  if (delta > 0.0) {
    if (high == e.r) {
      h = (e.g - e.b) / delta + select(0.0, 6.0, e.g < e.b);
    } else if (high == e.g) {
      h = (e.b - e.r) / delta + 2.0;
    } else {
      h = (e.r - e.g) / delta + 4.0;
    }
  }
  return vec4f(h / 6.0, select(0.0, delta / high, high > 0.0), high, c.a);
}`;

const FROM_HSV_FN = "color_ramp_from_hsv";
const FROM_HSV_SOURCE = `fn ${FROM_HSV_FN}(c: vec4f) -> vec4f {
  let s = clamp(c.y, 0.0, 1.0);
  let v = max(c.z, 0.0);
  let k = (vec3f(5.0, 3.0, 1.0) + fract(c.x) * 6.0) % 6.0;
  let rgb = v - v * s * clamp(min(k, 4.0 - k), vec3f(0.0), vec3f(1.0));
  return vec4f(${DECODE_FN}(rgb), c.a);
}`;

const TO_OKLCH_FN = "color_ramp_to_oklch";
const TO_OKLCH_SOURCE = `fn ${TO_OKLCH_FN}(c: vec4f) -> vec4f {
  let lms = ${wgslMat3(LINEAR_RGB_TO_LMS)} * c.rgb;
  let lab = ${wgslMat3(LMS_TO_OKLAB)} * (sign(lms) * pow(abs(lms), vec3f(1.0 / 3.0)));
  return vec4f(fract(atan2(lab.z, lab.y) / ${TAU}), length(lab.yz), lab.x, c.a);
}`;

const FROM_OKLCH_FN = "color_ramp_from_oklch";
const FROM_OKLCH_SOURCE = `fn ${FROM_OKLCH_FN}(c: vec4f) -> vec4f {
  let angle = fract(c.x) * ${TAU};
  let chroma = max(c.y, 0.0);
  let lms = ${wgslMat3(OKLAB_TO_LMS)} * vec3f(max(c.z, 0.0), chroma * cos(angle), chroma * sin(angle));
  return vec4f(${wgslMat3(LMS_TO_LINEAR_RGB)} * (lms * lms * lms), c.a);
}`;

const TO_SPACE_FN = "color_ramp_to_space";
const TO_SPACE_SOURCE = `fn ${TO_SPACE_FN}(c: vec4f, space: u32) -> vec4f {
  switch (space) {
    case ${String(RAMP_HSV)}u: { return ${TO_HSV_FN}(c); }
    case ${String(RAMP_OKLCH)}u: { return ${TO_OKLCH_FN}(c); }
    default: { return c; }
  }
}`;

const FROM_SPACE_FN = "color_ramp_from_space";
const FROM_SPACE_SOURCE = `fn ${FROM_SPACE_FN}(c: vec4f, space: u32) -> vec4f {
  switch (space) {
    case ${String(RAMP_HSV)}u: { return ${FROM_HSV_FN}(c); }
    case ${String(RAMP_OKLCH)}u: { return ${FROM_OKLCH_FN}(c); }
    default: { return c; }
  }
}`;

const HUE_DELTA_FN = "color_ramp_hue_delta";
const HUE_DELTA_SOURCE = `fn ${HUE_DELTA_FN}(a: f32, b: f32, mode: u32) -> f32 {
  let d = fract(b - a);
  switch (mode) {
    case ${String(HUE_LONGER)}u: { return select(d, d - 1.0, d < 0.5); }
    case ${String(HUE_INCREASING)}u: { return d; }
    case ${String(HUE_DECREASING)}u: { return select(d - 1.0, 0.0, d == 0.0); }
    default: { return select(d, d - 1.0, d > 0.5); }
  }
}`;

const SLOPE_FN = "color_ramp_slope";
const SLOPE_SOURCE = `fn ${SLOPE_FN}(q0: vec4f, q1: vec4f, q2: vec4f, h0: f32, h1: f32) -> vec4f {
  let left = select(vec4f(0.0), (q1 - q0) / h0, h0 > 0.0);
  let right = select(vec4f(0.0), (q2 - q1) / h1, h1 > 0.0);
  let span = h0 + h1;
  let middle = select(left, (left * h1 + right * h0) / span, span > 0.0);
  return (sign(left) + sign(right)) * min(min(abs(left), abs(right)), 0.5 * abs(middle));
}`;

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** Statements setting `r` to the segment's colour, interpolated as `interpolation` picks. */
function interpolationLines(ctx: WgslCtx, interpolation: number): string[] {
	switch (interpolation) {
		case RAMP_CONSTANT:
			return ["r = select(q1, q2, t >= 1.0);"];
		case RAMP_EASE:
			return ["r = mix(q1, q2, t * t * (3.0 - 2.0 * t));"];
		case RAMP_CARDINAL: {
			const fc = RAMP_CARDINAL_TENSION;
			return [
				"let t2 = t * t;",
				"let t3 = t2 * t;",
				`r = (${f(-fc)} * t3 + ${f(2 * fc)} * t2 - ${f(fc)} * t) * q0` +
					` + (${f(2 - fc)} * t3 + ${f(fc - 3)} * t2 + 1.0) * q1` +
					` + (${f(fc - 2)} * t3 + ${f(3 - 2 * fc)} * t2 + ${f(fc)} * t) * q2` +
					` + (${f(fc)} * t3 - ${f(fc)} * t2) * q3;`,
			];
		}
		case RAMP_B_SPLINE:
			return [
				"let b0 = select(q0, 2.0 * q1 - q2, first);",
				"let b3 = select(q3, 2.0 * q2 - q1, last);",
				"let t2 = t * t;",
				"let t3 = t2 * t;",
				"r = ((-t3 + 3.0 * t2 - 3.0 * t + 1.0) * b0 + (3.0 * t3 - 6.0 * t2 + 4.0) * q1" +
					" + (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) * q2 + t3 * b3) / 6.0;",
			];
		case RAMP_SMOOTH: {
			const slope = ctx.fn(SLOPE_FN, SLOPE_SOURCE);
			return [
				"let h = x2 - x1;",
				`let m1 = select(${slope}(q0, q1, q2, x1 - x0, h), vec4f(0.0), first);`,
				`let m2 = select(${slope}(q1, q2, q3, h, x3 - x2), vec4f(0.0), last);`,
				"let t2 = t * t;",
				"let t3 = t2 * t;",
				"r = (2.0 * t3 - 3.0 * t2 + 1.0) * q1 + (-2.0 * t3 + 3.0 * t2) * q2" +
					" + (t3 - 2.0 * t2 + t) * h * m1 + (t3 - t2) * h * m2;",
			];
		}
		default:
			return ["r = mix(q1, q2, t);"];
	}
}

/** Polar spaces' hues unwrapped along the four stops; mirrors `unwrapHues`. */
function hueLines(ctx: WgslCtx): string[] {
	const delta = ctx.fn(HUE_DELTA_FN, HUE_DELTA_SOURCE);
	const near = `${String(HUE_SHORTER)}u`;
	return [
		...[0, 1, 2, 3].map(
			(i) => `let grey${String(i)} = q${String(i)}.y < ${String(RAMP_ACHROMATIC)};`,
		),
		"let h1 = select(select(select(q3.x, q0.x, !grey0), q2.x, !grey2), q1.x, !grey1);",
		`let h2 = h1 + select(${delta}(q1.x, q2.x, hue), 0.0, grey1 || grey2);`,
		`let h0 = select(h1 - ${delta}(q0.x, h1, select(hue, ${near}, grey1)), h1, grey0);`,
		`let h3 = select(h2 + ${delta}(h2, q3.x, select(hue, ${near}, grey2)), h2, grey3);`,
		"q0.x = h0;",
		"q1.x = h1;",
		"q2.x = h2;",
		"q3.x = h3;",
	];
}

/**
 * The function interpolating a segment of a ramp, the enums known while
 * compiling built in (only what they pick is computed), the others switched
 * on per pixel. Mirrors `evaluateRamp` past finding the segment.
 */
function rampFunction(
	ctx: WgslCtx,
	interpolation: number | undefined,
	space: number | undefined,
	hue: number | undefined,
): string {
	const polar = space === RAMP_HSV || space === RAMP_OKLCH;
	const known = (n: number | undefined) => (n === undefined ? "any" : String(n));
	const name = `color_ramp_${known(interpolation)}_${known(space)}_${polar || space === undefined ? known(hue) : "none"}`;

	let to: (c: string) => string;
	let from: (c: string) => string;
	if (space === RAMP_HSV) {
		ctx.fn(ENCODE_FN, ENCODE_SOURCE);
		ctx.fn(DECODE_FN, DECODE_SOURCE);
		to = (c) => `${ctx.fn(TO_HSV_FN, TO_HSV_SOURCE)}(${c})`;
		from = (c) => `${ctx.fn(FROM_HSV_FN, FROM_HSV_SOURCE)}(${c})`;
	} else if (space === RAMP_OKLCH) {
		to = (c) => `${ctx.fn(TO_OKLCH_FN, TO_OKLCH_SOURCE)}(${c})`;
		from = (c) => `${ctx.fn(FROM_OKLCH_FN, FROM_OKLCH_SOURCE)}(${c})`;
	} else if (space === undefined) {
		ctx.fn(ENCODE_FN, ENCODE_SOURCE);
		ctx.fn(DECODE_FN, DECODE_SOURCE);
		ctx.fn(TO_HSV_FN, TO_HSV_SOURCE);
		ctx.fn(FROM_HSV_FN, FROM_HSV_SOURCE);
		ctx.fn(TO_OKLCH_FN, TO_OKLCH_SOURCE);
		ctx.fn(FROM_OKLCH_FN, FROM_OKLCH_SOURCE);
		to = (c) => `${ctx.fn(TO_SPACE_FN, TO_SPACE_SOURCE)}(${c}, space)`;
		from = (c) => `${ctx.fn(FROM_SPACE_FN, FROM_SPACE_SOURCE)}(${c}, space)`;
	} else {
		to = (c) => c;
		from = (c) => c;
	}

	const hues =
		space === undefined
			? [
					`if (space == ${String(RAMP_HSV)}u || space == ${String(RAMP_OKLCH)}u) {`,
					...hueLines(ctx).map((l) => `  ${l}`),
					"}",
				]
			: polar
				? hueLines(ctx)
				: [];

	const mixing =
		interpolation === undefined
			? [
					"switch (interpolation) {",
					...RAMP_INTERPOLATIONS.filter((v) => v.value !== RAMP_LINEAR).flatMap((v) => [
						`  case ${String(v.value)}u: {`,
						...interpolationLines(ctx, v.value).map((l) => `    ${l}`),
						"  }",
					]),
					"  default: {",
					...interpolationLines(ctx, RAMP_LINEAR).map((l) => `    ${l}`),
					"  }",
					"}",
				]
			: interpolationLines(ctx, interpolation);

	const body = [
		...[0, 1, 2, 3].map((i) => `var q${String(i)} = ${to(`c${String(i)}`)};`),
		...hues,
		"if (first) { q0 = q1; }",
		"if (last) { q3 = q2; }",
		"let t = select(select(0.0, 1.0, x >= x2), clamp((x - x1) / (x2 - x1), 0.0, 1.0), x2 > x1);",
		"var r: vec4f;",
		...mixing,
		`return ${from("r")};`,
	];
	const source = [
		`fn ${name}(x: f32, x0: f32, x1: f32, x2: f32, x3: f32, c0: vec4f, c1: vec4f, c2: vec4f, c3: vec4f, first: bool, last: bool, interpolation: u32, space: u32, hue: u32) -> vec4f {`,
		...body.map((l) => `  ${l}`),
		"}",
	].join("\n");
	return ctx.fn(name, source);
}

/**
 * A colour picked along stops by a factor, after Blender's Color Ramp: each
 * stop's colour is an input of its own (so it can be linked), its position
 * is the node's data, edited on the gradient drawn on the node. The colours
 * are interpolated in RGB, HSV or OKLch, any of the interpolations in any
 * space; these are enum inputs, so groups can pass theirs on.
 */
export function buildColorRampDescriptor(data: NodeData): NodeDescriptor {
	const stops = colorRampStops(data);
	const stopInputs: NodeInputDef[] = stops.map((stop, i) => ({
		id: stop.id,
		label: `Stop ${String(i + 1)}`,
		types: ["vec3f", "vec4f"],
		family: COLOR_FAMILY,
		control: { kind: "color" },
	}));
	return {
		type: COLOR_RAMP,
		label: "Color Ramp",
		aliases: [
			"ColorRamp",
			"Color Band",
			"Gradient",
			"Gradient Map",
			"Lookup Table",
			"Palette",
			"Ramp",
			"Heatmap",
		],
		category: "color",
		primaryInput: stops[0]?.id,
		widget: { kind: "ramp" },
		inputs: [
			{
				id: RAMP_FACTOR,
				label: "factor",
				types: ["f32"],
				control: { kind: "number", softMin: 0, softMax: 1 },
			},
			{
				id: RAMP_INTERPOLATION,
				label: "interpolation",
				types: ["u32"],
				control: { kind: "enum", variants: RAMP_INTERPOLATIONS },
			},
			{
				id: RAMP_SPACE,
				label: "color space",
				types: ["u32"],
				control: { kind: "enum", variants: RAMP_SPACES },
			},
			{
				id: RAMP_HUE,
				label: "hue",
				types: ["u32"],
				control: { kind: "enum", variants: RAMP_HUES },
			},
			...stopInputs,
		],
		outputs: [{ id: "color", label: "color", type: "vec3f" }],
		defaultData: {
			ramp: [...DEFAULT_RAMP],
			values: {
				[RAMP_FACTOR]: 0.5,
				[RAMP_INTERPOLATION]: RAMP_LINEAR,
				[RAMP_SPACE]: RAMP_RGB,
				[RAMP_HUE]: HUE_SHORTER,
				...Object.fromEntries(
					stops.flatMap((s) => {
						const color = DEFAULT_COLORS[s.id];
						return color ? [[s.id, color]] : [];
					}),
				),
			},
		},
		cpu: (ctx) => {
			const mode = (id: string) => ctx.input(id)[0] ?? 0;
			const width = typeComponents(ctx.outputType);
			const colors = stops.map((stop) => {
				const [r = 0, g = 0, b = 0, a = 1] = ctx.input(stop.id);
				return { position: stop.position, color: [r, g, b, width === 4 ? a : 1] as const };
			});
			const color = evaluateRamp(colors, ctx.input(RAMP_FACTOR)[0] ?? 0, {
				interpolation: mode(RAMP_INTERPOLATION),
				space: mode(RAMP_SPACE),
				hue: mode(RAMP_HUE),
			});
			return { color: coerce(color.slice(0, width), ctx.outputType) };
		},
		wgsl: (ctx) => {
			const v = ctx.varName;
			const count = stops.length;
			const rgba = ctx.outputType === "vec4f";
			const only = stops[0];
			if (count < 2 || !only) return [`let ${v} = ${ctx.promoteInput(only?.id ?? "")};`];

			const color = (id: string) =>
				rgba ? ctx.promoteInput(id) : `vec4f(${ctx.promoteInput(id)}, 1.0)`;
			const known = (id: string, variants: typeof RAMP_SPACES) => {
				const value = knownEnum(ctx, id, variants);
				return {
					value,
					arg: value === undefined ? ctx.promoteInput(id) : `${String(value)}u`,
				};
			};
			const interpolation = known(RAMP_INTERPOLATION, RAMP_INTERPOLATIONS);
			const space = known(RAMP_SPACE, RAMP_SPACES);
			const hue = known(RAMP_HUE, RAMP_HUES);
			const segment = rampFunction(ctx, interpolation.value, space.value, hue.value);

			const n = String(count);
			const last = String(count - 1);
			const x = `${v}_x`;
			const positions = `${v}_positions`;
			const colors = `${v}_colors`;
			const i = `${v}_segment`;
			const k = `${v}_k`;
			const around = [`max(${i} - 1, 0)`, i, `${i} + 1`, `min(${i} + 2, ${last})`];
			const args = [
				x,
				...around.map((index) => `${positions}[${index}]`),
				...around.map((index) => `${colors}[${index}]`),
				`${i} == 0`,
				`${i} + 2 >= ${n}`,
				interpolation.arg,
				space.arg,
				hue.arg,
			];
			return [
				`let ${x} = ${ctx.promoteInput(RAMP_FACTOR)};`,
				`var ${positions} = array<f32, ${n}>(${stops.map((s, index) => ctx.param(`position${String(index)}`, s.position)).join(", ")});`,
				`var ${colors} = array<vec4f, ${n}>(${stops.map((s) => color(s.id)).join(", ")});`,
				// The segment starting at the last stop at or before the factor.
				`var ${i} = 0;`,
				`for (var ${k} = 1; ${k} < ${last}; ${k}++) { if (${positions}[${k}] <= ${x}) { ${i} = ${k}; } }`,
				`let ${v}_rgba = ${segment}(${args.join(", ")});`,
				`let ${v} = ${rgba ? `${v}_rgba` : `${v}_rgba.rgb`};`,
			];
		},
	};
}
