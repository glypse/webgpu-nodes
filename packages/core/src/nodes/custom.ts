import { type HandleDef, type NodeData, type NodeDescriptor, wgslTypeName } from "../types";

export const CUSTOM_WGSL = "custom-wgsl";

export type CustomSockets = { inputs: HandleDef[]; outputs: HandleDef[] };
export type SocketSide = keyof CustomSockets;

const DEFAULT_SOCKETS: CustomSockets = {
	inputs: [{ id: "uv", label: "uv", type: "vec2f" }],
	outputs: [{ id: "color", label: "color", type: "vec3f" }],
};
const DEFAULT_CODE = "color = vec3f(uv, 0.5);";

/** WGSL words a socket can't be named, as they'd clash with the language. */
const RESERVED = new Set([
	"alias",
	"bitcast",
	"bool",
	"break",
	"case",
	"const",
	"const_assert",
	"continue",
	"continuing",
	"default",
	"diagnostic",
	"discard",
	"else",
	"enable",
	"f16",
	"f32",
	"false",
	"fn",
	"for",
	"i32",
	"if",
	"let",
	"loop",
	"override",
	"requires",
	"return",
	"struct",
	"switch",
	"true",
	"u32",
	"var",
	"while",
]);

/**
 * Whether `name` can name a socket: a WGSL identifier (no leading `__`, which
 * WGSL reserves) that isn't a keyword or a type.
 */
export function isSocketName(name: string): boolean {
	return (
		/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
		name !== "_" &&
		!name.startsWith("__") &&
		!RESERVED.has(name) &&
		!/^(vec[234]|mat[234]x[234])[fhiu]?$/.test(name)
	);
}

export function customSockets(data: NodeData): CustomSockets {
	return data.sockets ?? DEFAULT_SOCKETS;
}

/**
 * The function a Custom WGSL node compiles to: its inputs are parameters,
 * its outputs variables (zero until the code sets them) returned together.
 */
export function customFunction(
	name: string,
	{ inputs, outputs }: CustomSockets,
	code: string,
): string {
	const struct = `${name}_outputs`;
	const decl = (s: HandleDef) => `${s.label}: ${wgslTypeName(s.type)}`;
	const body = code
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
	return [
		`struct ${struct} {`,
		...outputs.map((s) => `  ${decl(s)},`),
		`}`,
		``,
		`fn ${name}(${inputs.map(decl).join(", ")}) -> ${struct} {`,
		...outputs.map((s) => `  var ${decl(s)};`),
		body,
		`  return ${struct}(${outputs.map((s) => s.label).join(", ")});`,
		`}`,
	].join("\n");
}

/** A Custom WGSL node, whose sockets are its own (`data.sockets`). */
export function buildCustomWgslDescriptor(data: NodeData): NodeDescriptor {
	const sockets = customSockets(data);
	return {
		type: CUSTOM_WGSL,
		label: "Custom WGSL",
		aliases: ["Code", "Script", "Expression", "Custom Function", "Shader Code"],
		category: "misc",
		staticOutputTypes: true,
		widget: { kind: "code" },
		defaultData: { code: DEFAULT_CODE, sockets: structuredClone(DEFAULT_SOCKETS) },
		inputs: sockets.inputs.map((s) => ({ id: s.id, label: s.label, types: [s.type] })),
		outputs: sockets.outputs.map((s) => ({ id: s.id, label: s.label, type: s.type })),
		wgsl: (ctx) => {
			if (sockets.outputs.length === 0) return [];
			const name = ctx.fn(
				`custom_${ctx.varName}`,
				customFunction(`custom_${ctx.varName}`, sockets, ctx.data.code ?? ""),
			);
			const args = sockets.inputs.map((s) => ctx.promoteInput(s.id)).join(", ");
			const call = `${name}(${args})`;
			const [only] = sockets.outputs;
			if (sockets.outputs.length === 1 && only) {
				return [`let ${ctx.varName} = ${call}.${only.label};`];
			}
			return [
				`let ${ctx.varName} = ${call};`,
				...sockets.outputs.map((s) => {
					const variable = ctx.outputVars[s.id] ?? `${ctx.varName}_${s.label}`;
					return `let ${variable} = ${ctx.varName}.${s.label};`;
				}),
			];
		},
	};
}

/** A free label for a new socket on `side`. */
export function newSocketLabel(sockets: CustomSockets, side: SocketSide): string {
	const taken = new Set([...sockets.inputs, ...sockets.outputs].map((s) => s.label));
	const base = side === "inputs" ? "input" : "output";
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base}${String(n)}`;
		if (!taken.has(name)) return name;
	}
}
