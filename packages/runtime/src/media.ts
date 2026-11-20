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
/** How many decoded samples of a video are kept, for sources showing the frames just before. */
const RECENT_SAMPLES = 4;
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

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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
	/** Told why media can't be drawn; what stands in for it is transparent. */
	onError: (message: string) => void = () => undefined;
	private files: MediaFiles = () => undefined;
	private empty: GPUTexture;
	private images = new Map<string, Image>();
	private videos = new Map<string, VideoStream>();
	/**
	 * The videos `prepare` decodes. A stream keeps the frames last decoded,
	 * which drawing `videos` at other times would otherwise replace before
	 * they're read.
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

	/** Throws when this device can't hold a texture of this size. */
	checkSize(width: number, height: number) {
		const max = this.device.limits.maxTextureDimension2D;
		if (width > max || height > max) {
			throw new Error(
				`It's ${String(width)}×${String(height)} pixels, more than this GPU's ${String(max)}.`,
			);
		}
	}

	/** Read assets' files from `files` from now on. */
	setFiles(files: MediaFiles) {
		this.files = files;
	}

	/** A transparent 1×1 texture, read where there's nothing to read. */
	get emptyTexture(): GPUTexture {
		return this.empty;
	}

	/**
	 * The texture `source` shows at project time `time` (what the source's own
	 * `time` evaluates to, for a video), decoded so far.
	 */
	texture(source: TextureSource, time: number): GPUTexture {
		if (source.kind !== "media") return this.empty;
		const file = this.files(source.asset);
		if (!file) return this.empty;
		if (source.video) {
			const stream = this.video(this.videos, source.asset, file, () => {
				this.onChange();
			});
			return stream.frameAt({ view: source.id, playback: source.video, time });
		}
		return this.image(source.asset, file).texture ?? this.empty;
	}

	/**
	 * Decode what `sources` show, each at the project time `timeOf` gives it,
	 * e.g. before reading an exported frame back, whatever `texture` is asked
	 * for meanwhile. Returns their textures.
	 */
	async prepare(
		sources: readonly TextureSource[],
		timeOf: (source: TextureSource) => number,
	): Promise<TextureOf> {
		const frames = new Map<string, GPUTexture>();
		const groups = new Map<string, { stream: VideoStream; requests: VideoRequest[] }>();
		const videos: { source: TextureSource; request: VideoRequest; stream: VideoStream }[] = [];
		const loading: Promise<void>[] = [];
		for (const source of sources) {
			if (source.kind !== "media") continue;
			const file = this.files(source.asset);
			if (!file) continue;
			if (source.video) {
				const stream = this.video(this.preparedVideos, source.asset, file, () => undefined);
				const request = {
					view: source.id,
					playback: source.video,
					time: timeOf(source),
				};
				videos.push({ source, request, stream });
				const group = groups.get(source.asset) ?? { stream, requests: [] };
				group.requests.push(request);
				groups.set(source.asset, group);
			} else {
				loading.push(this.loadImage(source.asset, file));
			}
		}
		await Promise.all([
			...loading,
			...[...groups.values()].map((group) => group.stream.decode(group.requests)),
		]);
		for (const { source, request, stream } of videos) {
			frames.set(source.id, stream.current(request));
		}
		return (source) => frames.get(source.id) ?? this.texture(source, timeOf(source));
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
			.then(async (bitmap) => {
				try {
					if (this.images.get(asset) !== image) return;
					this.checkSize(bitmap.width, bitmap.height);
					image.texture = await this.uploadChecked(bitmap);
				} finally {
					bitmap.close();
				}
			})
			.catch((error: unknown) => {
				image.failed = true;
				console.error("[media] can't decode an image", error);
				this.onError(`An image can't be used. ${describe(error)}`);
			});
	}

	/** Upload an image, throwing if the GPU refuses it. */
	private async uploadChecked(bitmap: ImageBitmap): Promise<GPUTexture> {
		this.device.pushErrorScope("out-of-memory");
		this.device.pushErrorScope("validation");
		const texture = this.upload(bitmap, bitmap.width, bitmap.height, 0);
		const refused = (await this.device.popErrorScope()) ?? (await this.device.popErrorScope());
		if (refused) {
			texture.destroy();
			throw new Error(refused.message);
		}
		return texture;
	}

	/** The stream decoding an asset's video, one for all the sources showing it. */
	private video(
		videos: Map<string, VideoStream>,
		asset: string,
		file: Blob,
		onFrame: () => void,
	): VideoStream {
		this.closeIdleVideos();
		const known = videos.get(asset);
		if (known?.file === file) return known;
		known?.close();
		const stream = new VideoStream(file, this, onFrame);
		videos.set(asset, stream);
		return stream;
	}

	private closeIdleVideos() {
		const now = performance.now() / 1000;
		for (const videos of [this.videos, this.preparedVideos]) {
			for (const [id, stream] of videos) {
				if (now - stream.lastUsed < IDLE_SECONDS) {
					stream.dropIdleViews();
					continue;
				}
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

/** What a stream keeps of a source showing it: its texture, and the sample that's in it. */
type View = { texture?: GPUTexture; shown?: VideoSample; lastUsed: number };

/** What a source asks of a stream: the project time it shows, played as its node says. */
export type VideoRequest = { view: string; playback: VideoPlayback; time: number };

/**
 * One video file, shared by every source showing it. Decodes the frames
 * the sources' times need, frame by frame while they move forward, seeking
 * otherwise, and keeps the latest few decoded samples, so a source showing
 * the frame before another's costs no decode. Only the latest request of
 * each source waiting is decoded, so a frame that must be the one asked for
 * needs a stream nothing else requests from. A source's texture only takes
 * a sample when it's read, so frames nothing draws cost no GPU time, and a
 * video decoding slower than it plays keeps moving, late, until it seeks.
 */
class VideoStream {
	lastUsed = performance.now() / 1000;
	private input: Input;
	private sink: Promise<OpenVideo | undefined>;
	private views = new Map<string, View>();
	private samples: AsyncGenerator<VideoSample, void> | undefined;
	/** The samples read most recently, in order: the last is the one read last. */
	private recent: VideoSample[] = [];
	private capacity = RECENT_SAMPLES;
	private decoding: Promise<void> | undefined;
	private wanted = new Map<string, number>();
	private duration: number | undefined;
	private closed = false;

	constructor(
		readonly file: Blob,
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
			this.library.checkSize(await track.getDisplayWidth(), await track.getDisplayHeight());
			return {
				sink: new VideoSampleSink(track),
				packets: new EncodedPacketSink(track),
				duration: await this.input.computeDuration(),
			};
		} catch (error) {
			console.error("[media] can't decode a video", error);
			this.library.onError(`A video can't be used. ${describe(error)}`);
			return undefined;
		}
	}

	/** The frame a source shows, decoded so far; it asks for the right one. */
	frameAt(request: VideoRequest): GPUTexture {
		this.lastUsed = performance.now() / 1000;
		this.request([request]).catch((error: unknown) => {
			console.error("[media] can't decode a video frame", error);
		});
		return this.current(request);
	}

	/** Decode the frames sources show, together: one may need what another read. */
	async decode(requests: readonly VideoRequest[]): Promise<void> {
		this.lastUsed = performance.now() / 1000;
		this.capacity = Math.max(RECENT_SAMPLES, requests.length + 1);
		await this.request(requests);
	}

	current({ view, playback, time }: VideoRequest): GPUTexture {
		const entry = this.view(view);
		const t = this.timeIn(playback, time);
		const sample = t === undefined ? undefined : this.sampleAt(t);
		if (sample && sample !== entry.shown) {
			const frame = sample.toVideoFrame();
			entry.texture = this.library.uploadFrame(
				frame,
				Math.round(sample.rotation / 90),
				entry.texture,
			);
			frame.close();
			entry.shown = sample;
		}
		return entry.texture && t !== undefined ? entry.texture : this.library.emptyTexture;
	}

	private view(id: string): View {
		let view = this.views.get(id);
		if (!view) {
			view = { lastUsed: 0 };
			this.views.set(id, view);
		}
		view.lastUsed = performance.now() / 1000;
		return view;
	}

	/** Frees the textures of sources nothing has drawn for a while. */
	dropIdleViews() {
		const now = performance.now() / 1000;
		for (const [id, view] of this.views) {
			if (now - view.lastUsed < IDLE_SECONDS) continue;
			view.texture?.destroy();
			this.views.delete(id);
		}
	}

	/** Video time at project time `time`, given the file's duration once known. */
	private timeIn(playback: VideoPlayback, time: number): number | undefined {
		return this.duration === undefined ? undefined : videoTime(playback, time, this.duration);
	}

	/** The sample showing at video time `t`, else the closest read before it, or after. */
	private sampleAt(t: number): VideoSample | undefined {
		const covering = this.covering(t);
		if (covering) return covering;
		let before: VideoSample | undefined;
		for (const sample of this.recent) if (sample.timestamp <= t) before = sample;
		return before ?? this.recent[0];
	}

	private covering(t: number): VideoSample | undefined {
		return this.recent.find((s) => t >= s.timestamp && t < sampleEnd(s));
	}

	private async request(requests: readonly VideoRequest[]): Promise<void> {
		const opened = await this.sink;
		if (!opened || this.closed) return;
		this.duration = opened.duration;
		for (const { view, playback, time } of requests) {
			const t = this.timeIn(playback, time);
			if (t !== undefined && !this.covering(t)) this.wanted.set(view, t);
		}
		if (this.wanted.size === 0) return;
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
		// Sources asking in the same turn are decoded together, earliest first, so
		// reading forward to a later one doesn't throw away an earlier one's.
		await Promise.resolve();
		while (this.wanted.size > 0 && !this.closed) {
			const times = [...this.wanted.values()].sort((a, b) => a - b);
			this.wanted.clear();
			for (const t of times) await this.readTo(video, t);
		}
	}

	/** Read samples up to the one shown at video time `t`, from the last one or a seek. */
	private async readTo(video: OpenVideo, t: number) {
		if (this.covering(t)) return;
		const from = this.recent.at(-1)?.timestamp;
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
			const ahead = this.recent.at(-1);
			if (ahead && sampleEnd(ahead) > t) return;
			const next = await this.samples?.next();
			if (!next || next.done) return;
			if (this.closed) {
				next.value.close();
				return;
			}
			this.recent.push(next.value);
			while (this.recent.length > this.capacity) this.recent.shift()?.close();
			this.onFrame();
		}
	}

	private async seek({ sink }: OpenVideo, t: number) {
		await this.samples?.return();
		for (const sample of this.recent) sample.close();
		this.recent = [];
		this.samples = sink.samples(t);
	}

	close() {
		this.closed = true;
		void this.samples?.return();
		for (const sample of this.recent) sample.close();
		this.recent = [];
		for (const view of this.views.values()) view.texture?.destroy();
		this.views.clear();
		this.input.dispose();
	}
}

function sampleEnd(sample: VideoSample): number {
	return sample.timestamp + sample.duration;
}
