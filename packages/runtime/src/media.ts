import { type TextureSource, type VideoPlayback, videoTime } from "$core";
import {
	ALL_FORMATS,
	BlobSource,
	EncodedPacketSink,
	Input,
	type VideoSample,
	VideoSampleSink,
} from "mediabunny";

/** The format media is decoded into: what programs draw, linear and straight-alpha. */
const MEDIA_FORMAT: GPUTextureFormat = "rgba16float";
/** Videos nothing has drawn for this long are closed, freeing their decoder. */
const IDLE_SECONDS = 10;
/** How far ahead a video decodes frame by frame rather than looking for a later key frame. */
const SEEK_AHEAD_SECONDS = 2;

/** Turns sRGB-encoded values linear, sign preserving so extended-range ones stay outside [0, 1]. */
const DECODE_COMMON_WGSL = `
fn linear(c: vec3f) -> vec3f {
	let a = abs(c);
	return sign(c) * select(pow((a + 0.055) / 1.055, vec3f(2.4)), a / 12.92, a <= vec3f(0.04045));
}

struct DecodeVarying {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@vertex
fn decode_vertex(@builtin(vertex_index) index: u32) -> DecodeVarying {
	let corner = vec2f(f32(index & 1u) * 4.0 - 1.0, f32(index >> 1u) * 4.0 - 1.0);
	return DecodeVarying(vec4f(corner, 0.0, 1.0), vec2f(corner.x + 1.0, 1.0 - corner.y) * 0.5);
}
`;

/** Reads an sRGB-encoded copy, rotating a video frame upright by quarter turns. */
const DECODE_COPY_WGSL = `${DECODE_COMMON_WGSL}
override quarter_turns: u32 = 0u;

@group(0) @binding(0) var source: texture_2d<f32>;

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

/** Reads a video frame itself, rotating it upright by quarter turns. */
const DECODE_FRAME_WGSL = `${DECODE_COMMON_WGSL}
override quarter_turns: u32 = 0u;

@group(0) @binding(0) var source: texture_external;
@group(0) @binding(1) var source_sampler: sampler;

@fragment
fn decode_fragment(@location(0) target_uv: vec2f) -> @location(0) vec4f {
	var uv = target_uv;
	switch quarter_turns {
		case 1u: { uv = vec2f(uv.y, 1.0 - uv.x); }
		case 2u: { uv = 1.0 - uv; }
		case 3u: { uv = vec2f(1.0 - uv.y, uv.x); }
		default: {}
	}
	let color = textureSampleBaseClampToEdge(source, source_sampler, uv);
	return vec4f(linear(color.rgb), color.a);
}
`;

/** The files of a project's assets, by asset id. */
export type MediaFiles = (asset: string) => Blob | undefined;

/** The texture a program reads for each of its sources. */
export type TextureOf = (source: TextureSource) => GPUTexture;

type Image = { file: Blob; texture?: GPUTexture; failed?: boolean };

type OpenVideo = { sink: VideoSampleSink; packets: EncodedPacketSink; duration: number };

/** A way of decoding: its shader, the layout of what it reads, a pipeline per rotation. */
type Decoder = {
	module: GPUShaderModule;
	layout: GPUBindGroupLayout;
	pipelines: Map<number, GPURenderPipeline>;
};

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
	/**
	 * The videos `prepare` decodes. A stream holds a single frame, which drawing
	 * `videos` at another time would otherwise replace before it's read.
	 */
	private preparedVideos = new Map<string, VideoStream>();
	private copyDecoder: Decoder;
	private frameDecoder: Decoder;
	private frameSampler: GPUSampler;

	constructor(private device: GPUDevice) {
		this.empty = device.createTexture({
			size: { width: 1, height: 1 },
			format: MEDIA_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		const visibility = GPUShaderStage.FRAGMENT;
		this.copyDecoder = {
			module: device.createShaderModule({ code: DECODE_COPY_WGSL }),
			layout: device.createBindGroupLayout({
				entries: [
					{ binding: 0, visibility, texture: { sampleType: "unfilterable-float" } },
				],
			}),
			pipelines: new Map(),
		};
		this.frameDecoder = {
			module: device.createShaderModule({ code: DECODE_FRAME_WGSL }),
			layout: device.createBindGroupLayout({
				entries: [
					{ binding: 0, visibility, externalTexture: {} },
					{ binding: 1, visibility, sampler: {} },
				],
			}),
			pipelines: new Map(),
		};
		this.frameSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
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
		if (source.video) {
			const stream = this.video(this.videos, source.id, file, source.video, () => {
				this.onChange();
			});
			return stream.frameAt(time);
		}
		return this.image(source.asset, file).texture ?? this.empty;
	}

	/**
	 * Decode what `sources` show at `time`, e.g. before reading an exported frame
	 * back, whatever `texture` is asked for meanwhile. Returns their textures.
	 */
	async prepare(sources: readonly TextureSource[], time: number): Promise<TextureOf> {
		const frames = new Map<string, GPUTexture>();
		await Promise.all(
			sources.map(async (source) => {
				if (source.kind !== "media") return;
				const file = this.files(source.asset);
				if (!file) return;
				if (source.video) {
					const stream = this.video(
						this.preparedVideos,
						source.id,
						file,
						source.video,
						() => undefined,
					);
					await stream.decode(time);
					frames.set(source.id, stream.current(time));
				} else {
					await this.loadImage(source.asset, file);
				}
			}),
		);
		return (source) => frames.get(source.id) ?? this.texture(source, time);
	}

	destroy() {
		this.empty.destroy();
		for (const image of this.images.values()) image.texture?.destroy();
		for (const videos of [this.videos, this.preparedVideos]) {
			for (const video of videos.values()) video.close();
			videos.clear();
		}
		this.images.clear();
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

	private video(
		videos: Map<string, VideoStream>,
		id: string,
		file: Blob,
		playback: VideoPlayback,
		onFrame: () => void,
	): VideoStream {
		this.closeIdleVideos();
		const known = videos.get(id);
		if (known?.file === file) return known;
		known?.close();
		const stream = new VideoStream(file, playback, this, onFrame);
		videos.set(id, stream);
		return stream;
	}

	private closeIdleVideos() {
		const now = performance.now() / 1000;
		for (const videos of [this.videos, this.preparedVideos]) {
			for (const [id, stream] of videos) {
				if (now - stream.lastUsed < IDLE_SECONDS) continue;
				stream.close();
				videos.delete(id);
			}
		}
	}

	/**
	 * A linear texture of `frame` turned `quarterTurns` clockwise: `target` when
	 * it's the right size. An opaque frame is read where it was decoded, sparing
	 * a video the copy, several times the memory traffic of its own texture. A
	 * frame with alpha is copied, as an external texture premultiplies it.
	 */
	uploadFrame(frame: VideoFrame, quarterTurns: number, target?: GPUTexture): GPUTexture {
		const { displayWidth: width, displayHeight: height } = frame;
		if (frame.format === null || frame.format.includes("A"))
			return this.upload(frame, width, height, quarterTurns, target);
		const output = this.output(width, height, quarterTurns, target);
		this.decode(this.frameDecoder, quarterTurns, output, [
			{ binding: 0, resource: this.device.importExternalTexture({ source: frame }) },
			{ binding: 1, resource: this.frameSampler },
		]);
		return output;
	}

	/**
	 * A linear texture of `source` (sRGB-encoded, straight alpha), `width` by
	 * `height` before turning it `quarterTurns` clockwise.
	 */
	private upload(
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
		const output = this.output(width, height, quarterTurns, target);
		this.decode(this.copyDecoder, quarterTurns, output, [
			{ binding: 0, resource: staging.createView() },
		]);
		staging.destroy();
		return output;
	}

	/** The texture of an image turned `quarterTurns`: `target` when it's the right size. */
	private output(
		width: number,
		height: number,
		quarterTurns: number,
		target?: GPUTexture,
	): GPUTexture {
		const turned = quarterTurns % 2 === 1;
		const size = { width: turned ? height : width, height: turned ? width : height };
		if (target?.width === size.width && target.height === size.height) return target;
		target?.destroy();
		return this.device.createTexture({
			size,
			format: MEDIA_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
	}

	private decode(
		decoder: Decoder,
		quarterTurns: number,
		output: GPUTexture,
		entries: GPUBindGroupEntry[],
	) {
		const encoder = this.device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: output.createView(), loadOp: "clear", storeOp: "store" }],
		});
		pass.setPipeline(this.decodePipeline(decoder, quarterTurns));
		pass.setBindGroup(0, this.device.createBindGroup({ layout: decoder.layout, entries }));
		pass.draw(3);
		pass.end();
		this.device.queue.submit([encoder.finish()]);
	}

	private decodePipeline(decoder: Decoder, quarterTurns: number): GPURenderPipeline {
		let pipeline = decoder.pipelines.get(quarterTurns);
		if (!pipeline) {
			pipeline = this.device.createRenderPipeline({
				layout: this.device.createPipelineLayout({ bindGroupLayouts: [decoder.layout] }),
				vertex: { module: decoder.module },
				fragment: {
					module: decoder.module,
					targets: [{ format: MEDIA_FORMAT }],
					constants: { quarter_turns: quarterTurns },
				},
			});
			decoder.pipelines.set(quarterTurns, pipeline);
		}
		return pipeline;
	}
}

/**
 * One video played one way: decodes the frame each requested time shows,
 * frame by frame while it moves forward, seeking otherwise. Only the latest
 * request waiting is decoded, so a frame that must be the one asked for needs
 * a stream nothing else requests from. The texture only takes the last frame
 * decoded when it's read, so frames nothing draws cost no GPU time, and a
 * video decoding slower than it plays keeps moving, late, until it seeks.
 */
class VideoStream {
	lastUsed = performance.now() / 1000;
	private input: Input;
	private sink: Promise<OpenVideo | undefined>;
	private texture: GPUTexture | undefined;
	private samples: AsyncGenerator<VideoSample, void> | undefined;
	/** The last sample read from `samples`, still open. */
	private ahead: VideoSample | undefined;
	/** The sample the texture shows. */
	private shown: VideoSample | undefined;
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
				packets: new EncodedPacketSink(track),
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
	}

	current(time: number): GPUTexture {
		const sample = this.ahead;
		if (sample && sample !== this.shown) {
			const frame = sample.toVideoFrame();
			this.texture = this.library.uploadFrame(
				frame,
				Math.round(sample.rotation / 90),
				this.texture,
			);
			frame.close();
			this.shown = sample;
		}
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
		const ahead = this.ahead;
		if (t === undefined || (ahead && t >= ahead.timestamp && t < sampleEnd(ahead))) return;
		this.wanted = t;
		this.decoding ??= this.decodeWanted(opened)
			.catch((error: unknown) => {
				// Closing disposes of the input it's reading.
				if (!this.closed) throw error;
			})
			.finally(() => {
				this.decoding = undefined;
			});
		await this.decoding;
	}

	private async decodeWanted(video: OpenVideo) {
		while (this.wanted !== undefined && !this.closed) {
			const t = this.wanted;
			this.wanted = undefined;
			await this.readTo(video, t);
		}
	}

	/** Read samples up to the one shown at video time `t`, from the last one or a seek. */
	private async readTo(video: OpenVideo, t: number) {
		const from = this.ahead?.timestamp;
		if (!this.samples || from === undefined || t < from) {
			await this.seek(video, t);
		} else if (t > from + SEEK_AHEAD_SECONDS) {
			// Seeking to `t` itself decodes from its key frame without showing
			// anything, for longer than a video falling behind can spare: it
			// would be behind again by the time it got there, and never show.
			const key = await video.packets.getKeyPacket(t, { metadataOnly: true });
			if (key && key.timestamp > from) await this.seek(video, key.timestamp);
		}
		for (;;) {
			const ahead = this.ahead;
			if (ahead && sampleEnd(ahead) > t) return;
			const next = await this.samples?.next();
			if (!next || next.done) return;
			ahead?.close();
			if (this.isClosed()) {
				next.value.close();
				return;
			}
			this.ahead = next.value;
			this.onFrame();
		}
	}

	private async seek({ sink }: OpenVideo, t: number) {
		await this.samples?.return();
		this.ahead?.close();
		this.ahead = undefined;
		this.samples = sink.samples(t);
	}

	private isClosed(): boolean {
		return this.closed;
	}

	close() {
		this.closed = true;
		void this.samples?.return();
		this.ahead?.close();
		this.ahead = undefined;
		this.texture?.destroy();
		this.input.dispose();
	}
}

function sampleEnd(sample: VideoSample): number {
	return sample.timestamp + sample.duration;
}
