import { CURVE_SOLVE_STEPS, LINEAR_CURVE, curveSegments } from "../curve";
import type { NodeDescriptor } from "../types";
import { FLOAT_TYPES, typeComponents, wgslTypeName } from "../types";

const SEGMENT_FN = "curveSegment";

/**
 * y at `x` on a Bézier segment packed as `a` = (start, first control) and
 * `b` = (second control, end). Mirrors `segmentParameter`.
 */
const SEGMENT_SOURCE = `fn ${SEGMENT_FN}(x: f32, a: vec4f, b: vec4f) -> f32 {
  let p0 = a.xy;
  let c0 = a.zw;
  let c1 = b.xy;
  let p1 = b.zw;
  var low = 0.0;
  var high = 1.0;
  var t = 0.5;
  if (p1.x > p0.x) { t = clamp((x - p0.x) / (p1.x - p0.x), 0.0, 1.0); }
  for (var i = 0; i < ${String(CURVE_SOLVE_STEPS)}; i++) {
    let u = 1.0 - t;
    let error = u * u * u * p0.x + 3.0 * u * u * t * c0.x + 3.0 * u * t * t * c1.x + t * t * t * p1.x - x;
    if (abs(error) < 1e-7) { break; }
    if (error < 0.0) { low = t; } else { high = t; }
    let slope = 3.0 * u * u * (c0.x - p0.x) + 6.0 * u * t * (c1.x - c0.x) + 3.0 * t * t * (p1.x - c1.x);
    let next = t - error / slope;
    t = select(0.5 * (low + high), next, slope > 0.0 && next > low && next < high);
  }
  let u = 1.0 - t;
  return u * u * u * p0.y + 3.0 * u * u * t * c0.y + 3.0 * u * t * t * c1.y + t * t * t * p1.y;
}`;

/** y at `x` on a curve of `count` segments, flat past its ends. */
function curveSource(name: string, count: number): string {
	const size = String(2 * count);
	return `fn ${name}(x: f32, segments: array<vec4f, ${size}>) -> f32 {
  var s = segments;
  if (x <= s[0].x) { return s[0].y; }
  for (var i = 0; i < ${String(count)}; i++) {
    if (x <= s[2 * i + 1].z) { return ${SEGMENT_FN}(x, s[2 * i], s[2 * i + 1]); }
  }
  return s[${String(2 * count - 1)}].w;
}`;
}

/**
 * Maps each component of a value through a curve drawn on the node, mixed
 * with the value by a factor (past 1, the mapping is exaggerated).
 */
export const curveNode: NodeDescriptor = {
	type: "curve",
	label: "Curve",
	aliases: [
		"Float Curve",
		"Vector Curves",
		"RGB Curves",
		"Curves",
		"Tone Curve",
		"Lookup",
		"Easing",
		"Ease",
	],
	category: "math",
	inputs: [
		{
			id: "factor",
			label: "factor",
			types: ["f32"],
			control: { kind: "number", min: 0, softMax: 1 },
		},
		{ id: "value", label: "value", types: FLOAT_TYPES },
	],
	outputs: [{ id: "result", label: "result", type: "f32" }],
	primaryInput: "value",
	defaultData: { values: { factor: 1, value: 0 }, curve: [...LINEAR_CURVE] },
	widget: { kind: "curve" },
	wgsl: (ctx) => {
		const points = ctx.data.curve ?? LINEAR_CURVE;
		const segments = curveSegments(points);
		const value = `${ctx.varName}_value`;
		const lines = [`let ${value} = ${ctx.promoteInput("value")};`];

		let map: (x: string) => string;
		if (segments.length === 0) {
			const level = ctx.param("level", points[0]?.y ?? 0);
			map = () => level;
		} else {
			ctx.fn(SEGMENT_FN, SEGMENT_SOURCE);
			const name = `curve${String(segments.length)}`;
			ctx.fn(name, curveSource(name, segments.length));
			const packed = segments.flatMap(([p0, c0, c1, p1], i) => [
				ctx.param(`segment${String(i)}a`, [p0.x, p0.y, c0.x, c0.y]),
				ctx.param(`segment${String(i)}b`, [c1.x, c1.y, p1.x, p1.y]),
			]);
			const array = `${ctx.varName}_segments`;
			lines.push(
				`let ${array} = array<vec4f, ${String(packed.length)}>(${packed.join(", ")});`,
			);
			map = (x) => `${name}(${x}, ${array})`;
		}

		const type = ctx.outputType;
		const n = typeComponents(type);
		const mapped =
			n === 1
				? map(value)
				: `${wgslTypeName(type)}(${["x", "y", "z", "w"]
						.slice(0, n)
						.map((c) => map(`${value}.${c}`))
						.join(", ")})`;
		lines.push(`let ${ctx.varName} = mix(${value}, ${mapped}, ${ctx.promoteInput("factor")});`);
		return lines;
	},
};
