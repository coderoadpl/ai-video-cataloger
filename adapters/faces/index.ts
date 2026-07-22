import os from 'node:os';

import { FfmpegMediaAdapter, type RgbFrame } from '@adapters/ffmpeg/index.js';
import {
  FACE_QUALITY,
  FILE_ARTIFACTS,
  appError,
  applySimilarityTransform,
  estimateSimilarityTransform,
  normalizeEmbedding,
  ok,
  type AppError,
  type FaceBox,
  type FaceLandmarks,
  type FacePoint,
  type Result,
  type SimilarityTransform,
} from '@core/domain/index.js';
import type { AlignedFaceCrop, DependencyStatus, FaceDetection, FaceEnginePort, FaceFrameInput, ModelDownloadPort } from '@core/server/index.js';

export interface OrtTensor {
  data: Float32Array | Int32Array | Uint8Array | readonly number[];
  dims: readonly number[];
}

export interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

export interface OrtSessionFactory {
  create(modelPath: string, executionProviders: readonly string[]): Promise<OrtSession>;
  tensor(data: Float32Array, dims: readonly number[]): OrtTensor;
}

export interface FaceImageIO {
  decodeFrameRgb(input: FaceFrameInput): Promise<Result<RgbFrame, AppError>>;
  encodeJpeg(frame: RgbFrame, outputPath: string): Promise<Result<void, AppError>>;
}

export interface FaceEngineAdapterOptions {
  downloads: ModelDownloadPort;
  sessionFactory?: OrtSessionFactory | undefined;
  imageIO?: FaceImageIO | undefined;
}

export interface LetterboxMeta {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  resizedWidth: number;
  resizedHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface TensorImage {
  tensor: Float32Array;
  meta: LetterboxMeta;
}

interface RgbSample {
  r: number;
  g: number;
  b: number;
}

const YUNET_INPUT_SIZE = 640;
const SFACE_INPUT_SIZE = 112;
const YUNET_STRIDES: readonly [8, 16, 32] = [8, 16, 32];
const YUNET_NMS_THRESHOLD = 0.3;
const YUNET_TOP_K = 5000;

export const SFACE_ALIGNMENT_TEMPLATE: readonly FacePoint[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

const ffmpegImageIO = (): FaceImageIO => {
  const media = new FfmpegMediaAdapter();
  return {
    decodeFrameRgb: (input) => input.kind === 'image-path'
      ? media.decodeFrameRgb({ kind: 'image-path', imagePath: input.frameJpegPath })
      : media.decodeFrameRgb({ kind: 'video-timestamp', videoPath: input.videoPath, timestampS: input.timestampS }),
    encodeJpeg: (frame, outputPath) => media.encodeRgbJpeg(frame, outputPath),
  };
};

export class OnnxFaceEngineAdapter implements FaceEnginePort {
  private detector: OrtSession | null = null;
  private embedder: OrtSession | null = null;
  private readonly sessionFactory: OrtSessionFactory;
  private readonly imageIO: FaceImageIO;
  private readonly frameCache = new Map<string, RgbFrame>();

  constructor(private readonly options: FaceEngineAdapterOptions) {
    this.sessionFactory = options.sessionFactory ?? defaultOrtSessionFactory;
    this.imageIO = options.imageIO ?? ffmpegImageIO();
  }

  async load(): Promise<Result<void, AppError>> {
    if (this.detector !== null && this.embedder !== null) return ok(undefined);
    try {
      this.detector = await this.sessionFactory.create(
        this.options.downloads.fileArtifactPath(FILE_ARTIFACTS['face-detector/yunet-2023mar']),
        executionProviders(),
      );
      this.embedder = await this.sessionFactory.create(
        this.options.downloads.fileArtifactPath(FILE_ARTIFACTS['face-embedder/sface-2021dec']),
        executionProviders(),
      );
      return ok(undefined);
    } catch (cause) {
      return { ok: false, error: appError('prerequisites_failed', errorMessage(cause, 'Failed to load face models'), cause) };
    }
  }

  async detect(frame: FaceFrameInput | string): Promise<Result<FaceDetection[], AppError>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    if (this.detector === null) return { ok: false, error: appError('internal', 'Face detector session is not loaded') };
    const input = normalizeFrameInput(frame);
    const decoded = await this.readFrame(input);
    if (!decoded.ok) return decoded;
    const prepared = createYuNetTensor(decoded.value);
    const inputName = this.detector.inputNames[0] ?? 'input';
    const output = await this.runSession(this.detector, {
      [inputName]: this.sessionFactory.tensor(prepared.tensor, [1, 3, YUNET_INPUT_SIZE, YUNET_INPUT_SIZE]),
    }, `Failed to detect faces in ${frameLabel(input)}`);
    if (!output.ok) return output;
    return ok(parseDetections(output.value, prepared.meta));
  }

  async align(frameJpegPath: string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>> {
    const frame = await this.readFrame(frameJpegPath);
    if (!frame.ok) return frame;
    const transform = estimateSimilarityTransform(faceAlignmentSource(detection.landmarks), SFACE_ALIGNMENT_TEMPLATE);
    const transformedNose = applySimilarityTransform(transform, detection.landmarks.nose);
    if (!Number.isFinite(transformedNose.x) || !Number.isFinite(transformedNose.y)) {
      return { ok: false, error: appError('processing_error', 'Face alignment failed') };
    }
    return ok({
      frameJpegPath,
      detection,
      width: SFACE_INPUT_SIZE,
      height: SFACE_INPUT_SIZE,
      data: warpAlignedFaceRgb(frame.value, transform, SFACE_INPUT_SIZE, SFACE_INPUT_SIZE),
    });
  }

  async embed(alignedCrop: AlignedFaceCrop): Promise<Result<Float32Array, AppError>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    if (this.embedder === null) return { ok: false, error: appError('internal', 'Face embedder session is not loaded') };
    const crop = await this.cropData(alignedCrop);
    if (!crop.ok) return crop;
    const inputName = this.embedder.inputNames[0] ?? 'input';
    const output = await this.runSession(this.embedder, {
      [inputName]: this.sessionFactory.tensor(createSFaceTensor(crop.value), [1, 3, alignedCrop.height, alignedCrop.width]),
    }, `Failed to embed face crop from ${alignedCrop.frameJpegPath}`);
    if (!output.ok) return output;
    const tensor = firstTensor(output.value);
    if (tensor === null) return { ok: false, error: appError('processing_error', 'Face embedding output is empty') };
    const values = Array.from(tensorFloats(tensor)).slice(0, 128);
    if (values.length !== 128) return { ok: false, error: appError('processing_error', 'Face embedding output must contain 128 values') };
    return ok(new Float32Array(normalizeEmbedding(values)));
  }

  writeCrop(alignedCrop: AlignedFaceCrop, outputPath: string): Promise<Result<void, AppError>> {
    const data = alignedCrop.data;
    if (data === undefined) {
      return Promise.resolve({ ok: false, error: appError('processing_error', 'Aligned crop has no pixel data') });
    }
    return this.imageIO.encodeJpeg({
      width: alignedCrop.width,
      height: alignedCrop.height,
      data,
    }, outputPath);
  }

  dispose(): Promise<Result<void, AppError>> {
    this.detector = null;
    this.embedder = null;
    this.frameCache.clear();
    return Promise.resolve(ok(undefined));
  }

  async dependency(): Promise<Result<DependencyStatus, AppError>> {
    const detector = await this.options.downloads.isFileArtifactDownloaded(FILE_ARTIFACTS['face-detector/yunet-2023mar']);
    if (!detector.ok) return detector;
    const embedder = await this.options.downloads.isFileArtifactDownloaded(FILE_ARTIFACTS['face-embedder/sface-2021dec']);
    if (!embedder.ok) return embedder;
    const available = detector.value && embedder.value;
    return ok({
      name: 'faces',
      available,
      version: null,
      source: available ? 'managed' : null,
      path: null,
      installHint: available ? '' : 'Run: ai-video-cataloger models faces install',
    });
  }

  private async readFrame(frame: FaceFrameInput | string): Promise<Result<RgbFrame, AppError>> {
    const input = normalizeFrameInput(frame);
    const cacheKey = frameCacheKey(input);
    const cached = this.frameCache.get(cacheKey);
    if (cached !== undefined) return ok(cached);
    const decoded = await this.imageIO.decodeFrameRgb(input);
    if (!decoded.ok) return decoded;
    this.frameCache.set(cacheKey, decoded.value);
    if (input.kind === 'video-timestamp' && input.fallbackFrameJpegPath !== undefined) {
      this.frameCache.set(frameCacheKey({ kind: 'image-path', frameJpegPath: input.fallbackFrameJpegPath }), decoded.value);
    }
    return decoded;
  }

  private async cropData(alignedCrop: AlignedFaceCrop): Promise<Result<RgbFrame, AppError>> {
    if (alignedCrop.data !== undefined) {
      return ok({ width: alignedCrop.width, height: alignedCrop.height, data: alignedCrop.data });
    }
    const aligned = await this.align(alignedCrop.frameJpegPath, alignedCrop.detection);
    if (!aligned.ok) return aligned;
    const data = aligned.value.data;
    if (data === undefined) return { ok: false, error: appError('processing_error', 'Face alignment produced no pixels') };
    return ok({ width: aligned.value.width, height: aligned.value.height, data });
  }

  private async runSession(
    session: OrtSession,
    feeds: Record<string, OrtTensor>,
    message: string,
  ): Promise<Result<Record<string, OrtTensor>, AppError>> {
    try {
      return ok(await session.run(feeds));
    } catch (cause) {
      return { ok: false, error: appError('processing_error', errorMessage(cause, message), cause) };
    }
  }
}

export const executionProviders = (): readonly string[] =>
  os.platform() === 'darwin' && os.arch() === 'arm64' ? ['coreml', 'cpu'] : ['cpu'];

export const createYuNetTensor = (frame: RgbFrame): TensorImage => {
  const targetWidth = YUNET_INPUT_SIZE;
  const targetHeight = YUNET_INPUT_SIZE;
  const scale = Math.min(targetWidth / frame.width, targetHeight / frame.height);
  const resizedWidth = Math.max(1, Math.round(frame.width * scale));
  const resizedHeight = Math.max(1, Math.round(frame.height * scale));
  const offsetX = Math.floor((targetWidth - resizedWidth) / 2);
  const offsetY = Math.floor((targetHeight - resizedHeight) / 2);
  const meta: LetterboxMeta = {
    sourceWidth: frame.width,
    sourceHeight: frame.height,
    targetWidth,
    targetHeight,
    resizedWidth,
    resizedHeight,
    offsetX,
    offsetY,
    scale,
  };
  const tensor = new Float32Array(targetWidth * targetHeight * 3);
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      if (x < offsetX || y < offsetY || x >= offsetX + resizedWidth || y >= offsetY + resizedHeight) continue;
      const sourceX = (x - offsetX + 0.5) / scale - 0.5;
      const sourceY = (y - offsetY + 0.5) / scale - 0.5;
      const sample = sampleRgbClamped(frame, sourceX, sourceY);
      const index = y * targetWidth + x;
      tensor[index] = sample.b;
      tensor[targetWidth * targetHeight + index] = sample.g;
      tensor[2 * targetWidth * targetHeight + index] = sample.r;
    }
  }
  return { tensor, meta };
};

export const createSFaceTensor = (frame: RgbFrame): Float32Array => {
  const tensor = new Float32Array(frame.width * frame.height * 3);
  const plane = frame.width * frame.height;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const source = rgbIndex(frame.width, x, y);
      const target = y * frame.width + x;
      tensor[target] = frame.data[source] ?? 0;
      tensor[plane + target] = frame.data[source + 1] ?? 0;
      tensor[2 * plane + target] = frame.data[source + 2] ?? 0;
    }
  }
  return tensor;
};

export const parseDetections = (outputs: Record<string, OrtTensor>, meta?: LetterboxMeta | undefined): FaceDetection[] => {
  const rows = parseOpenCvRows(outputs, meta);
  if (rows.length > 0) return rows;
  if (meta === undefined) return [];
  return decodeYuNetOutputs(outputs, meta, FACE_QUALITY.minScore, YUNET_NMS_THRESHOLD);
};

export const decodeYuNetOutputs = (
  outputs: Record<string, OrtTensor>,
  meta: LetterboxMeta,
  scoreThreshold: number,
  nmsThreshold: number,
): FaceDetection[] => {
  const decoded: FaceDetection[] = [];
  for (const stride of YUNET_STRIDES) {
    const cls = tensorByName(outputs, `cls_${stride}`);
    const obj = tensorByName(outputs, `obj_${stride}`);
    const bbox = tensorByName(outputs, `bbox_${stride}`);
    const kps = tensorByName(outputs, `kps_${stride}`);
    if (cls === null || obj === null || bbox === null || kps === null) continue;
    decoded.push(...decodeYuNetStride(cls, obj, bbox, kps, stride, meta, scoreThreshold));
  }
  return nonMaxSuppression(
    decoded.sort((left, right) => right.score - left.score).slice(0, YUNET_TOP_K),
    nmsThreshold,
  );
};

export const nonMaxSuppression = (detections: readonly FaceDetection[], threshold: number): FaceDetection[] => {
  const selected: FaceDetection[] = [];
  const ordered = [...detections].sort((left, right) => right.score - left.score);
  for (const detection of ordered) {
    if (selected.some((kept) => intersectionOverUnion(kept.bbox, detection.bbox) >= threshold)) continue;
    selected.push(detection);
  }
  return selected;
};

export const warpAlignedFaceRgb = (
  source: RgbFrame,
  transform: SimilarityTransform,
  width: number,
  height: number,
): Uint8Array => {
  const output = new Uint8Array(width * height * 3);
  const denominator = transform.a * transform.a + transform.b * transform.b;
  if (denominator === 0) return output;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - transform.tx;
      const dy = y - transform.ty;
      const sourceX = (transform.a * dx + transform.b * dy) / denominator;
      const sourceY = (-transform.b * dx + transform.a * dy) / denominator;
      const sample = sampleRgb(source, sourceX, sourceY);
      const target = rgbIndex(width, x, y);
      output[target] = Math.round(sample.r);
      output[target + 1] = Math.round(sample.g);
      output[target + 2] = Math.round(sample.b);
    }
  }
  return output;
};

const decodeYuNetStride = (
  clsTensor: OrtTensor,
  objTensor: OrtTensor,
  bboxTensor: OrtTensor,
  kpsTensor: OrtTensor,
  stride: number,
  meta: LetterboxMeta,
  scoreThreshold: number,
): FaceDetection[] => {
  const cols = meta.targetWidth / stride;
  const rows = meta.targetHeight / stride;
  const cls = tensorFloats(clsTensor);
  const obj = tensorFloats(objTensor);
  const bbox = tensorFloats(bboxTensor);
  const kps = tensorFloats(kpsTensor);
  const detections: FaceDetection[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const anchor = row * cols + col;
      const classScore = clamp01(cls[anchor] ?? 0);
      const objectScore = clamp01(obj[anchor] ?? 0);
      const score = Math.sqrt(classScore * objectScore);
      if (score < scoreThreshold) continue;
      const boxOffset = anchor * 4;
      const centerX = (col + (bbox[boxOffset] ?? 0)) * stride;
      const centerY = (row + (bbox[boxOffset + 1] ?? 0)) * stride;
      const width = Math.exp(bbox[boxOffset + 2] ?? 0) * stride;
      const height = Math.exp(bbox[boxOffset + 3] ?? 0) * stride;
      const letterboxBox = { x: centerX - width / 2, y: centerY - height / 2, width, height };
      const mappedBox = mapBoxFromLetterbox(letterboxBox, meta);
      if (mappedBox.width <= 0 || mappedBox.height <= 0) continue;
      detections.push({
        bbox: mappedBox,
        landmarks: mapLandmarksFromLetterbox(kps, anchor, col, row, stride, meta),
        score,
      });
    }
  }
  return detections;
};

const mapLandmarksFromLetterbox = (
  kps: Float32Array,
  anchor: number,
  col: number,
  row: number,
  stride: number,
  meta: LetterboxMeta,
): FaceLandmarks => {
  const offset = anchor * 10;
  const point = (index: number): FacePoint =>
    mapPointFromLetterbox({
      x: (col + (kps[offset + index * 2] ?? 0)) * stride,
      y: (row + (kps[offset + index * 2 + 1] ?? 0)) * stride,
    }, meta);
  return {
    leftEye: point(1),
    rightEye: point(0),
    nose: point(2),
    leftMouth: point(4),
    rightMouth: point(3),
  };
};

const parseOpenCvRows = (outputs: Record<string, OrtTensor>, meta?: LetterboxMeta | undefined): FaceDetection[] => {
  const tensor = Object.values(outputs).find((candidate) => (candidate.dims.at(-1) ?? 0) >= 15);
  if (tensor === undefined) return [];
  const width = tensor.dims.at(-1) ?? 0;
  if (width < 15) return [];
  const values = tensorFloats(tensor);
  const rows = Math.floor(values.length / width);
  const detections: FaceDetection[] = [];
  for (let row = 0; row < rows; row += 1) {
    const offset = row * width;
    const score = values[offset + 14] ?? 0;
    const rawBox = {
      x: values[offset] ?? 0,
      y: values[offset + 1] ?? 0,
      width: values[offset + 2] ?? 0,
      height: values[offset + 3] ?? 0,
    };
    const bbox = meta === undefined ? rawBox : mapBoxFromLetterbox(rawBox, meta);
    if (bbox.width <= 0 || bbox.height <= 0) continue;
    const point = (index: number): FacePoint => {
      const rawPoint = { x: values[offset + index] ?? 0, y: values[offset + index + 1] ?? 0 };
      return meta === undefined ? rawPoint : mapPointFromLetterbox(rawPoint, meta);
    };
    detections.push({
      bbox,
      landmarks: {
        leftEye: point(6),
        rightEye: point(4),
        nose: point(8),
        leftMouth: point(12),
        rightMouth: point(10),
      },
      score,
    });
  }
  return detections;
};

const mapBoxFromLetterbox = (box: FaceBox, meta: LetterboxMeta): FaceBox => {
  const left = clamp((box.x - meta.offsetX) / meta.scale, 0, meta.sourceWidth);
  const top = clamp((box.y - meta.offsetY) / meta.scale, 0, meta.sourceHeight);
  const right = clamp((box.x + box.width - meta.offsetX) / meta.scale, 0, meta.sourceWidth);
  const bottom = clamp((box.y + box.height - meta.offsetY) / meta.scale, 0, meta.sourceHeight);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const mapPointFromLetterbox = (point: FacePoint, meta: LetterboxMeta): FacePoint => ({
  x: clamp((point.x - meta.offsetX) / meta.scale, 0, meta.sourceWidth),
  y: clamp((point.y - meta.offsetY) / meta.scale, 0, meta.sourceHeight),
});

const intersectionOverUnion = (left: FaceBox, right: FaceBox): number => {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection === 0) return 0;
  const union = left.width * left.height + right.width * right.height - intersection;
  return union <= 0 ? 0 : intersection / union;
};

const tensorByName = (outputs: Record<string, OrtTensor>, name: string): OrtTensor | null =>
  outputs[name] ?? null;

const tensorFloats = (tensor: OrtTensor): Float32Array =>
  tensor.data instanceof Float32Array ? tensor.data : Float32Array.from(tensor.data);

const firstTensor = (outputs: Record<string, OrtTensor>): OrtTensor | null => {
  const first = Object.values(outputs)[0];
  return first ?? null;
};

export const faceAlignmentSource = (landmarks: FaceLandmarks): readonly FacePoint[] => [
  landmarks.rightEye,
  landmarks.leftEye,
  landmarks.nose,
  landmarks.rightMouth,
  landmarks.leftMouth,
];

const normalizeFrameInput = (frame: FaceFrameInput | string): FaceFrameInput =>
  typeof frame === 'string' ? { kind: 'image-path', frameJpegPath: frame } : frame;

const frameCacheKey = (input: FaceFrameInput): string =>
  input.kind === 'image-path' ? `image:${input.frameJpegPath}` : `video:${input.videoPath}:${input.timestampS}`;

const frameLabel = (input: FaceFrameInput): string =>
  input.kind === 'image-path' ? input.frameJpegPath : `${input.videoPath}@${input.timestampS}s`;

const sampleRgb = (frame: RgbFrame, x: number, y: number): RgbSample => {
  if (x < 0 || y < 0 || x > frame.width - 1 || y > frame.height - 1) return { r: 0, g: 0, b: 0 };
  return sampleRgbInside(frame, x, y);
};

const sampleRgbClamped = (frame: RgbFrame, x: number, y: number): RgbSample =>
  sampleRgbInside(frame, clamp(x, 0, frame.width - 1), clamp(y, 0, frame.height - 1));

const sampleRgbInside = (frame: RgbFrame, x: number, y: number): RgbSample => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(frame.width - 1, x0 + 1);
  const y1 = Math.min(frame.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const topLeft = pixelRgb(frame, x0, y0);
  const topRight = pixelRgb(frame, x1, y0);
  const bottomLeft = pixelRgb(frame, x0, y1);
  const bottomRight = pixelRgb(frame, x1, y1);
  return {
    r: bilinear(topLeft.r, topRight.r, bottomLeft.r, bottomRight.r, fx, fy),
    g: bilinear(topLeft.g, topRight.g, bottomLeft.g, bottomRight.g, fx, fy),
    b: bilinear(topLeft.b, topRight.b, bottomLeft.b, bottomRight.b, fx, fy),
  };
};

const pixelRgb = (frame: RgbFrame, x: number, y: number): RgbSample => {
  const index = rgbIndex(frame.width, x, y);
  return {
    r: frame.data[index] ?? 0,
    g: frame.data[index + 1] ?? 0,
    b: frame.data[index + 2] ?? 0,
  };
};

const bilinear = (
  topLeft: number,
  topRight: number,
  bottomLeft: number,
  bottomRight: number,
  fx: number,
  fy: number,
): number => {
  const top = topLeft * (1 - fx) + topRight * fx;
  const bottom = bottomLeft * (1 - fx) + bottomRight * fx;
  return top * (1 - fy) + bottom * fy;
};

const rgbIndex = (width: number, x: number, y: number): number =>
  (y * width + x) * 3;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clamp01 = (value: number): number =>
  clamp(value, 0, 1);

const defaultOrtSessionFactory: OrtSessionFactory = {
  create: async (modelPath, providers) => {
    const ort = await import('onnxruntime-node');
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: [...providers] });
    return {
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      run: async (feeds) => {
        const realFeeds: Record<string, InstanceType<typeof ort.Tensor>> = {};
        for (const [name, value] of Object.entries(feeds)) {
          realFeeds[name] = new ort.Tensor('float32', toFloat32(value.data), [...value.dims]);
        }
        const outputs = await session.run(realFeeds);
        const mapped: Record<string, OrtTensor> = {};
        for (const [name, tensor] of Object.entries(outputs)) {
          mapped[name] = { data: toOrtData(tensor.data), dims: tensor.dims };
        }
        return mapped;
      },
    };
  },
  tensor: (data, dims) => {
    return { data, dims };
  },
};

const toFloat32 = (data: OrtTensor['data']): Float32Array =>
  data instanceof Float32Array ? data : Float32Array.from(data);

const toOrtData = (data: Iterable<number | string | bigint | boolean>): OrtTensor['data'] => {
  if (data instanceof Float32Array || data instanceof Int32Array || data instanceof Uint8Array) return data;
  const numbers: number[] = [];
  for (const value of data) if (typeof value === 'number') numbers.push(value);
  return numbers;
};

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;
