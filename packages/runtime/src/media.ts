import { type TextureSource, type VideoPlayback, videoTime } from "$core";
import { ALL_FORMATS, BlobSource, Input, type VideoSample, VideoSampleSink } from "mediabunny";

/** The format media is decoded into: what programs draw, linear and straight-alpha. */
const MEDIA_FORMAT: GPUTextureFormat = "rgba16float";
/** Videos nothing has drawn for this long are closed, freeing their decoder. */
const IDLE_SECONDS = 10;
/** How far ahead a video decodes frame by frame rather than seeking. */
const SEEK_AHEAD_SECONDS = 2;

/**
 * Turns an sRGB-encoded copy into linear values, sign preserving so
 * extended-range components stay outside [0, 1], and rotates a video frame
 * upright by quarter turns.
 */
const DECODE_WGSL = `
override quarter_turns: u32 = 0u;

@group(0) @binding(0) var source: texture_2d<f32>;

fn linear(c: vec3f) -> vec3f {
	let a = abs(c);
	return sign(c) * select(pow((a + 0.055) / 1.055, vec3f(2.4)), a / 12.92, a <= vec3f(0.04045));
}

@vertex
fn decode_vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
	let corner = vec2f(f32(index & 1u) * 4.0 - 1.0, f32(index >> 1u) * 4.0 - 1.0);
	return vec4f(corner, 0.0, 1.0);
}

@fragment
fn decode_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let d = vec2u(position.xy);
	let size = textureDimensions(source);
	var s = d;
	switch quarter_turns {
		case 1u: { s = vec2u(d.y, size.y - 1u - d.x); }
		case 2u: { s = vec2u(size.x - 1u - d.x, size.y - 1u - d.y); }
		case 3u: { s = vec2u(size.x - 1u - d.y, d.x); }
		default: {}
	}
	let color = textureLoad(source, s, 0);
	return vec4f(linear(color.rgb), color.a);
}
`;

/** The files of a project's assets, by asset id. */
export type MediaFiles = (asset: string) => Blob | undefined;

type Image = { file: Blob; texture?: GPUTexture; failed?: boolean };

/**
 * Decodes the media `TextureSource`s programs read into linear textures:
 * images once, videos at the frame the project's time shows. Decoding is
 * asynchronous: until a frame is ready, the last one (or a transparent
 * texture) stands in, and `onChange` tells when there is a new one to draw.
 */
export class MediaLibrary {
	/** Called when a texture got a newly decoded frame. */
	onChange: () => void = () => undefined;
	private files: MediaFiles = () => undefined;
	private empty: GPUTexture;
	private images = new Map<string, Image>();
	private videos = new Map<string, VideoStream>();
	private module: GPUShaderModule;
	private layout: GPUBindGroupLayout;
	private pipelines = new Map<number, GPURenderPipeline>();

	constructor(private device: GPUDevice) {
		this.empty = device.createTexture({
			size: { width: 1, height: 1 },
			format: MEDIA_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		this.module = device.createShaderModule({ code: DECODE_WGSL });
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

	/** Read assets' files from `files` from now on. */
	setFiles(files: MediaFiles) {
		this.files = files;
	}

	/** A transparent 1×1 texture, read where there's nothing to read. */
	get emptyTexture(): GPUTexture {
		return this.empty;
	}

	/** The texture `source` shows at project time `time`, decoded so far. */
	texture(source: TextureSource, time: number): GPUTexture {
		if (source.kind !== "media") return this.empty;
		const file = this.files(source.asset);
		if (!file) return this.empty;
		if (source.video) return this.video(source.id, file, source.video).frameAt(time);
		return this.image(source.asset, file).texture ?? this.empty;
	}

	/** Decode what `sources` show at `time`, e.g. before reading an exported frame back. */
	async prepare(sources: readonly TextureSource[], time: number): Promise<void> {
		await Promise.all(
			sources.map(async (source) => {
				if (source.kind !== "media") return;
				const file = this.files(source.asset);
				if (!file) return;
				if (source.video) await this.video(source.id, file, source.video).decode(time);
				else await this.loadImage(source.asset, file);
			}),
		);
	}

	destroy() {
		this.empty.destroy();
		for (const image of this.images.values()) image.texture?.destroy();
		for (const video of this.videos.values()) video.close();
		this.images.clear();
		this.videos.clear();
	}

	private image(asset: string, file: Blob): Image {
		const known = this.images.get(asset);
		if (known?.file === file) return known;
		void this.loadImage(asset, file).then(() => {
			this.onChange();
		});
		return this.images.get(asset) ?? { file };
	}

	private loadImage(asset: string, file: Blob): Promise<void> {
		const known = this.images.get(asset);
		if (known?.file === file && (known.texture || known.failed)) return Promise.resolve();
		known?.texture?.destroy();
		const image: Image = { file };
		this.images.set(asset, image);
		return createImageBitmap(file, { premultiplyAlpha: "none", imageOrientation: "from-image" })
			.then((bitmap) => {
				if (this.images.get(asset) !== image) return;
				image.texture = this.upload(bitmap, bitmap.width, bitmap.height, 0);
				bitmap.close();
			})
			.catch((error: unknown) => {
				image.failed = true;
				console.error("[media] can't decode an image", error);
			});
	}

	private video(id: string, file: Blob, playback: VideoPlayback): VideoStream {
		this.closeIdleVideos();
		const known = this.videos.get(id);
		if (known?.file === file) return known;
		known?.close();
		const stream = new VideoStream(file, playback, this, () => {
			this.onChange();
		});
		this.videos.set(id, stream);
		return stream;
	}

	private closeIdleVideos() {
		const now = performance.now() / 1000;
		for (const [id, stream] of this.videos) {
			if (now - stream.lastUsed < IDLE_SECONDS) continue;
			stream.close();
			this.videos.delete(id);
		}
	}

	/**
	 * A linear texture of `source` (sRGB-encoded, straight alpha), `width` by
	 * `height` before turning it `quarterTurns` clockwise.
	 */
	upload(
		source: ImageBitmap | VideoFrame,
		width: number,
		height: number,
		quarterTurns: number,
		target?: GPUTexture,
	): GPUTexture {
		const staging = this.device.createTexture({
			size: { width, height },
			format: MEDIA_FORMAT,
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT,
		});
		this.device.queue.copyExternalImageToTexture(
			{ source },
			{ texture: staging, colorSpace: "srgb", premultipliedAlpha: false },
			{ width, height },
		);
		const turned = quarterTurns % 2 === 1;
		const size = { width: turned ? height : width, height: turned ? width : height };
		const output =
			target?.width === size.width && target.height === size.height
				? target
				: this.device.createTexture({
						size,
						format: MEDIA_FORMAT,
						usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
					});
		if (target && target !== output) target.destroy();
		const encoder = this.device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: output.createView(), loadOp: "clear", storeOp: "store" }],
		});
		pass.setPipeline(this.decodePipeline(quarterTurns));
		pass.setBindGroup(
			0,
			this.device.createBindGroup({
				layout: this.layout,
				entries: [{ binding: 0, resource: staging.createView() }],
			}),
		);
		pass.draw(3);
		pass.end();
		this.device.queue.submit([encoder.finish()]);
		staging.destroy();
		return output;
	}

	private decodePipeline(quarterTurns: number): GPURenderPipeline {
		let pipeline = this.pipelines.get(quarterTurns);
		if (!pipeline) {
			pipeline = this.device.createRenderPipeline({
				layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
				vertex: { module: this.module },
				fragment: {
					module: this.module,
					targets: [{ format: MEDIA_FORMAT }],
					constants: { quarter_turns: quarterTurns },
				},
			});
			this.pipelines.set(quarterTurns, pipeline);
		}
		return pipeline;
	}
}

/**
 * One video played one way: decodes the frame each requested time shows,
 * frame by frame while it moves forward, seeking otherwise. Only the latest
 * request waiting is decoded.
 */
class VideoStream {
	lastUsed = performance.now() / 1000;
	private input: Input;
	private sink: Promise<{ sink: VideoSampleSink; duration: number } | undefined>;
	private texture: GPUTexture | undefined;
	/** The video time span the texture shows. */
	private shown: { start: number; end: number } | undefined;
	private samples: AsyncGenerator<VideoSample, void> | undefined;
	/** The last sample read from `samples`, still open. */
	private ahead: VideoSample | undefined;
	private decoding: Promise<void> | undefined;
	private wanted: number | undefined;
	private closed = false;

	constructor(
		readonly file: Blob,
		private playback: VideoPlayback,
		private library: MediaLibrary,
		private onFrame: () => void,
	) {
		this.input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		this.sink = this.open();
	}

	private async open() {
		try {
			const track = await this.input.getPrimaryVideoTrack();
			if (!track || !(await track.canDecode())) throw new Error("no decodable video track");
			return {
				sink: new VideoSampleSink(track),
				duration: await this.input.computeDuration(),
			};
		} catch (error) {
			console.error("[media] can't decode a video", error);
			return undefined;
		}
	}

	/** The frame shown at project time `time`, decoded so far; it asks for the right one. */
	frameAt(time: number): GPUTexture {
		this.lastUsed = performance.now() / 1000;
		this.request(time).catch((error: unknown) => {
			console.error("[media] can't decode a video frame", error);
		});
		return this.current(time);
	}

	/** Decode the frame shown at project time `time`. */
	async decode(time: number): Promise<void> {
		this.lastUsed = performance.now() / 1000;
		await this.request(time);
		// A request made while another decoded is decoded after it.
		await this.decoding;
	}

	private current(time: number): GPUTexture {
		return this.texture && this.timeIn(time) !== undefined
			? this.texture
			: this.library.emptyTexture;
	}

	/** Video time at project time `time`, given the file's duration once known. */
	private timeIn(time: number, duration = this.duration): number | undefined {
		return duration === undefined ? undefined : videoTime(this.playback, time, duration);
	}

	private duration: number | undefined;

	private async request(time: number): Promise<void> {
		const opened = await this.sink;
		if (!opened || this.closed) return;
		this.duration = opened.duration;
		const t = this.timeIn(time, opened.duration);
		if (t === undefined || (this.shown && t >= this.shown.start && t < this.shown.end)) return;
		this.wanted = t;
		this.decoding ??= this.decodeWanted(opened.sink).finally(() => {
			this.decoding = undefined;
		});
		await this.decoding;
	}

	private async decodeWanted(sink: VideoSampleSink) {
		while (this.wanted !== undefined && !this.closed) {
			const t = this.wanted;
			this.wanted = undefined;
			const sample = await this.sampleAt(sink, t);
			// Closed while it decoded.
			if (!sample || this.isClosed()) continue;
			const frame = sample.toVideoFrame();
			this.texture = this.library.upload(
				frame,
				frame.displayWidth,
				frame.displayHeight,
				Math.round(sample.rotation / 90),
				this.texture,
			);
			frame.close();
			this.shown = { start: sample.timestamp, end: sample.timestamp + sample.duration };
			this.onFrame();
		}
	}

	/** The sample shown at video time `t`: read on from the last one, or sought. */
	private async sampleAt(sink: VideoSampleSink, t: number): Promise<VideoSample | undefined> {
		const from = this.ahead?.timestamp;
		if (!this.samples || from === undefined || t < from || t > from + SEEK_AHEAD_SECONDS) {
			await this.samples?.return();
			this.ahead?.close();
			this.ahead = undefined;
			this.samples = sink.samples(t);
		}
		for (;;) {
			const ahead = this.ahead;
			if (ahead && ahead.timestamp + ahead.duration > t) return ahead;
			const next = await this.samples.next();
			if (next.done) return ahead;
			ahead?.close();
			this.ahead = next.value;
		}
	}

	private isClosed(): boolean {
		return this.closed;
	}

	close() {
		this.closed = true;
		void this.samples?.return();
		this.ahead?.close();
		this.texture?.destroy();
		this.input.dispose();
	}
}
