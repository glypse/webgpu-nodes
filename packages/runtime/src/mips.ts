const SHADER = /* wgsl */ `
@group(0) @binding(0) var source: texture_2d<f32>;

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
	let corner = vec2f(f32(index & 1u) * 4.0 - 1.0, f32(index >> 1u) * 4.0 - 1.0);
	return vec4f(corner, 0.0, 1.0);
}

// The mean of a 2x2 block; the last row or column of an odd size is read twice.
@fragment
fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let last = vec2i(textureDimensions(source)) - 1;
	let base = vec2i(position.xy) * 2;
	let a = textureLoad(source, min(base, last), 0);
	let b = textureLoad(source, min(base + vec2i(1, 0), last), 0);
	let c = textureLoad(source, min(base + vec2i(0, 1), last), 0);
	let d = textureLoad(source, min(base + vec2i(1, 1), last), 0);
	return (a + b + c + d) * 0.25;
}
`;

type Pipeline = { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout };

/**
 * Fills the mip levels of textures their pass drew the first level of, each
 * level the mean of 2x2 texels of the one before it. One pipeline per format.
 */
export class MipGenerator {
	private module: GPUShaderModule;
	private layout: GPUBindGroupLayout;
	private pipelines = new Map<GPUTextureFormat, Pipeline>();

	constructor(private device: GPUDevice) {
		this.module = device.createShaderModule({ code: SHADER });
		// Unfilterable binds any float texture, and reads are exact texels.
		this.layout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "unfilterable-float" },
				},
			],
		});
	}

	private pipeline(format: GPUTextureFormat): GPURenderPipeline {
		let made = this.pipelines.get(format);
		if (!made) {
			const pipeline = this.device.createRenderPipeline({
				layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
				vertex: { module: this.module, entryPoint: "vertex_main" },
				fragment: {
					module: this.module,
					entryPoint: "fragment_main",
					targets: [{ format }],
				},
			});
			made = { pipeline, layout: this.layout };
			this.pipelines.set(format, made);
		}
		return made.pipeline;
	}

	/** Encode the passes making every level of `texture` after its first. */
	generate(encoder: GPUCommandEncoder, texture: GPUTexture) {
		const pipeline = this.pipeline(texture.format);
		for (let level = 1; level < texture.mipLevelCount; level++) {
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
						loadOp: "clear",
						storeOp: "store",
					},
				],
			});
			pass.setPipeline(pipeline);
			pass.setBindGroup(
				0,
				this.device.createBindGroup({
					layout: this.layout,
					entries: [
						{
							binding: 0,
							resource: texture.createView({
								baseMipLevel: level - 1,
								mipLevelCount: 1,
							}),
						},
					],
				}),
			);
			pass.draw(3);
			pass.end();
		}
	}
}
