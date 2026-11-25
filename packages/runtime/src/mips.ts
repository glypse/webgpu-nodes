const SHADER = /* wgsl */ `
@group(0) @binding(0) var source: texture_2d<f32>;

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
	let corner = vec2f(f32(index & 1u) * 4.0 - 1.0, f32(index >> 1u) * 4.0 - 1.0);
	return vec4f(corner, 0.0, 1.0);
}

// Every source texel adds the same total weight to the level, so an odd side doesn't drift
// (the weights are those of mipWeights).
fn axis_weights(i: i32, n: i32) -> vec3f {
	if (n == 1) { return vec3f(1.0, 0.0, 0.0); }
	if ((n & 1) == 0) { return vec3f(0.5, 0.5, 0.0); }
	let m = n / 2;
	return vec3f(f32(m - i), f32(m), f32(i + 1)) / f32(n);
}

@fragment
fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let size = vec2i(textureDimensions(source));
	let texel = vec2i(position.xy);
	let wx = axis_weights(texel.x, size.x);
	let wy = axis_weights(texel.y, size.y);
	var sum = vec4f(0.0);
	for (var dy = 0; dy < 3; dy++) {
		for (var dx = 0; dx < 3; dx++) {
			let weight = wx[dx] * wy[dy];
			if (weight == 0.0) { continue; }
			let at = min(texel * 2 + vec2i(dx, dy), size - 1);
			sum += textureLoad(source, at, 0) * weight;
		}
	}
	return sum;
}
`;

type Pipeline = { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout };

type Levels = { views: GPUTextureView[]; groups: GPUBindGroup[] };

/**
 * Fills the mip levels of textures their pass drew the first level of, each
 * level a box filter of the one before it (see `mipWeights`). One pipeline per format.
 */
export class MipGenerator {
	private module: GPUShaderModule;
	private layout: GPUBindGroupLayout;
	private pipelines = new Map<GPUTextureFormat, Pipeline>();
	private levels = new WeakMap<GPUTexture, Levels>();

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

	/** The views and bind groups of a texture's levels, made once for as long as it lives. */
	private levelsOf(texture: GPUTexture): Levels {
		let levels = this.levels.get(texture);
		if (!levels) {
			const views = Array.from({ length: texture.mipLevelCount }, (_, level) =>
				texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
			);
			const groups = views.slice(0, -1).map((view) =>
				this.device.createBindGroup({
					layout: this.layout,
					entries: [{ binding: 0, resource: view }],
				}),
			);
			levels = { views, groups };
			this.levels.set(texture, levels);
		}
		return levels;
	}

	/** Encode the passes making every level of `texture` after its first. */
	generate(encoder: GPUCommandEncoder, texture: GPUTexture) {
		const pipeline = this.pipeline(texture.format);
		const { views, groups } = this.levelsOf(texture);
		for (let level = 1; level < texture.mipLevelCount; level++) {
			const view = views[level];
			const group = groups[level - 1];
			if (!view || !group) continue;
			const pass = encoder.beginRenderPass({
				colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }],
			});
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.draw(3);
			pass.end();
		}
	}
}
