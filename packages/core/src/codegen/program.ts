import type { UniformValue } from "./generate";

/** What the generated code reads per draw: the frame's timing and the target's size and gamut. */
export const FRAME_VAR = "runtime_frame";
/** The frame field telling whether the target is Display P3 (1) rather than sRGB (0). */
export const DISPLAY_P3_FIELD = "display_p3";
/** The struct holding the values of uniform inputs. */
export const UNIFORMS_VAR = "runtime_uniforms";
/** Per-fragment values readable from any function, unlike `frag()`'s own parameters. */
export const FRAGMENT_VAR = "runtime_fragment";

export type UniformScalar = "f32" | "u32";

export type UniformField = {
	/** Byte offset in the block. */
	offset: number;
	scalar: UniformScalar;
	components: 1 | 2 | 3 | 4;
};

/** A uniform buffer bound at `@group(0) @binding(binding)`, laid out by WGSL's rules. */
export type UniformBlock = {
	binding: number;
	/** Byte size, a multiple of 16. */
	size: number;
	fields: Readonly<Record<string, UniformField>>;
};

/**
 * A complete WGSL module drawing the graph over a fullscreen triangle, and the
 * buffers it reads. The fragment entry returns a linear, straight-alpha colour.
 */
export type ShaderProgram = {
	code: string;
	vertexEntry: string;
	fragmentEntry: string;
	/**
	 * Fields named after `FrameInputs`, plus `resolution` and `DISPLAY_P3_FIELD`,
	 * written by the runtime on each draw.
	 */
	frame: UniformBlock;
	/** Fields named after the uniforms `generateShader` returns. */
	uniforms: UniformBlock;
};

type FieldDecl = { name: string; scalar: UniformScalar; components: 1 | 2 | 3 | 4 };

const FRAME_FIELDS: readonly FieldDecl[] = [
	{ name: "time", scalar: "f32", components: 1 },
	{ name: "delta", scalar: "f32", components: 1 },
	{ name: "resolution", scalar: "f32", components: 2 },
	{ name: "frame", scalar: "u32", components: 1 },
	{ name: DISPLAY_P3_FIELD, scalar: "u32", components: 1 },
];

/** A struct can't be empty: this stands in when the graph has no uniforms. */
const PLACEHOLDER: FieldDecl = { name: "unused", scalar: "f32", components: 4 };

function wgslType({ scalar, components }: FieldDecl): string {
	return components === 1 ? scalar : `vec${String(components)}${scalar === "f32" ? "f" : "u"}`;
}

/** Offsets per WGSL's uniform layout: vec2 aligns to 8 bytes, vec3 and vec4 to 16. */
function layout(binding: number, decls: readonly FieldDecl[]): UniformBlock {
	const fields: Record<string, UniformField> = {};
	let offset = 0;
	for (const decl of decls) {
		const align = decl.components === 1 ? 4 : decl.components === 2 ? 8 : 16;
		offset = Math.ceil(offset / align) * align;
		fields[decl.name] = { offset, scalar: decl.scalar, components: decl.components };
		offset += decl.components * 4;
	}
	return { binding, size: Math.max(16, Math.ceil(offset / 16) * 16), fields };
}

function struct(name: string, decls: readonly FieldDecl[]): string {
	const fields = decls.map((d) => `\t${d.name}: ${wgslType(d)},`);
	return `struct ${name} {\n${fields.join("\n")}\n};`;
}

/** Wrap a fragment from `generateShader` (which defines `frag`) into a full program. */
export function buildProgram(
	fragment: string,
	uniforms: Readonly<Record<string, UniformValue>>,
): ShaderProgram {
	const uniformDecls: FieldDecl[] = Object.entries(uniforms).map(([name, value]) => ({
		name,
		scalar: "f32",
		components: typeof value === "number" ? 1 : value.length,
	}));
	if (uniformDecls.length === 0) uniformDecls.push(PLACEHOLDER);

	const frame = layout(0, FRAME_FIELDS);
	const uniformBlock = layout(1, uniformDecls);

	// uv's origin is the bottom-left corner, y pointing up.
	const code = `${struct("RuntimeFrame", FRAME_FIELDS)}
${struct("RuntimeUniforms", uniformDecls)}
struct RuntimeFragment {
	uv: vec2f,
};

@group(0) @binding(${String(frame.binding)}) var<uniform> ${FRAME_VAR}: RuntimeFrame;
@group(0) @binding(${String(uniformBlock.binding)}) var<uniform> ${UNIFORMS_VAR}: RuntimeUniforms;
var<private> ${FRAGMENT_VAR}: RuntimeFragment;

${fragment}

struct RuntimeVarying {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@vertex
fn runtime_vertex(@builtin(vertex_index) index: u32) -> RuntimeVarying {
	let corner = vec2f(f32(index & 1u) * 4.0 - 1.0, f32(index >> 1u) * 4.0 - 1.0);
	return RuntimeVarying(vec4f(corner, 0.0, 1.0), (corner + 1.0) * 0.5);
}

@fragment
fn runtime_fragment_main(in: RuntimeVarying) -> @location(0) vec4f {
	${FRAGMENT_VAR}.uv = in.uv;
	return frag(in.uv);
}
`;

	return {
		code,
		vertexEntry: "runtime_vertex",
		fragmentEntry: "runtime_fragment_main",
		frame,
		uniforms: uniformBlock,
	};
}
