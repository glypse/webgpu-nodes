import { type ColorSpace, SRGB_TO_DISPLAY_P3, wgslMat3 } from "$core";

/**
 * Turns the linear-sRGB colour a program drew into a display encoding:
 * converts it to Display P3 primaries when asked, applies the sRGB transfer
 * curve, and premultiplies alpha for a canvas (exports keep it straight).
 */
const PRESENT_WGSL = `
override display_p3: bool = false;
override premultiply: bool = true;

@group(0) @binding(0) var source: texture_2d<f32>;

const SRGB_TO_P3 = ${wgslMat3(SRGB_TO_DISPLAY_P3)};

fn encode(c: vec3f) -> vec3f {
	let v = max(c, vec3f(0.0));
	return select(1.055 * pow(v, vec3f(1.0 / 2.4)) - 0.055, v * 12.92, v <= vec3f(0.0031308));
}

@vertex
fn present_vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
	let corner = vec2f(f32(index & 1u) * 4.0 - 1.0, f32(index >> 1u) * 4.0 - 1.0);
	return vec4f(corner, 0.0, 1.0);
}

@fragment
fn present_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let color = textureLoad(source, vec2u(position.xy), 0);
	var rgb = color.rgb;
	if (display_p3) {
		rgb = SRGB_TO_P3 * rgb;
	}
	rgb = encode(rgb);
	let alpha = clamp(color.a, 0.0, 1.0);
	if (premultiply) {
		return vec4f(rgb * alpha, alpha);
	}
	return vec4f(rgb, alpha);
}
`;

export type PresentOptions = {
	format: GPUTextureFormat;
	colorSpace: ColorSpace;
	premultiply: boolean;
};

/** Pipelines presenting a linear texture, one per output format and encoding. */
export class Presenter {
	private module: GPUShaderModule;
	private layout: GPUBindGroupLayout;
	private pipelineLayout: GPUPipelineLayout;
	private pipelines = new Map<string, GPURenderPipeline>();
	private bindGroups = new WeakMap<GPUTexture, GPUBindGroup>();

	constructor(private device: GPUDevice) {
		this.module = device.createShaderModule({ code: PRESENT_WGSL });
		this.layout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "unfilterable-float" },
				},
			],
		});
		this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
	}

	private pipeline({ format, colorSpace, premultiply }: PresentOptions): GPURenderPipeline {
		const key = `${format}|${colorSpace}|${String(premultiply)}`;
		let pipeline = this.pipelines.get(key);
		if (!pipeline) {
			pipeline = this.device.createRenderPipeline({
				layout: this.pipelineLayout,
				vertex: { module: this.module },
				fragment: {
					module: this.module,
					targets: [{ format }],
					constants: {
						display_p3: colorSpace === "display-p3" ? 1 : 0,
						premultiply: premultiply ? 1 : 0,
					},
				},
			});
			this.pipelines.set(key, pipeline);
		}
		return pipeline;
	}

	/** Encode a pass drawing `source` into `target`, both the same size. */
	encode(
		encoder: GPUCommandEncoder,
		source: GPUTexture,
		target: GPUTextureView,
		options: PresentOptions,
	) {
		let bindGroup = this.bindGroups.get(source);
		if (!bindGroup) {
			bindGroup = this.device.createBindGroup({
				layout: this.layout,
				entries: [{ binding: 0, resource: source.createView() }],
			});
			this.bindGroups.set(source, bindGroup);
		}
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: target, loadOp: "clear", storeOp: "store" }],
		});
		pass.setPipeline(this.pipeline(options));
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
	}
}
