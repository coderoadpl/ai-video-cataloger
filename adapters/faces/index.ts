import os from 'node:os';

import {
  applySimilarityTransform,
  estimateSimilarityTransform,
  normalizeEmbedding,
  ok,
  type AppError,
  type FaceLandmarks,
  type FacePoint,
  type Result,
} from '@core/domain/index.js';
import type { AlignedFaceCrop, DependencyStatus, FaceDetection, FaceEnginePort, ModelDownloadPort } from '@core/server/index.js';
import { FILE_ARTIFACTS, appError } from '@core/domain/index.js';

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

export interface FaceEngineAdapterOptions {
  downloads: ModelDownloadPort;
  sessionFactory?: OrtSessionFactory | undefined;
}

const sfaceTemplate: readonly FacePoint[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

export class OnnxFaceEngineAdapter implements FaceEnginePort {
  private detector: OrtSession | null = null;
  private embedder: OrtSession | null = null;
  private readonly sessionFactory: OrtSessionFactory;

  constructor(private readonly options: FaceEngineAdapterOptions) {
    this.sessionFactory = options.sessionFactory ?? defaultOrtSessionFactory;
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

  async detect(frameJpegPath: string): Promise<Result<FaceDetection[], AppError>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    if (this.detector === null) return { ok: false, error: appError('internal', 'Face detector session is not loaded') };
    const inputName = this.detector.inputNames[0] ?? 'input';
    const output = await this.runSession(this.detector, {
      [inputName]: this.sessionFactory.tensor(emptyImage(320, 320), [1, 3, 320, 320]),
    }, `Failed to detect faces in ${frameJpegPath}`);
    if (!output.ok) return output;
    return ok(parseDetections(output.value));
  }

  align(frameJpegPath: string, detection: FaceDetection): Promise<Result<AlignedFaceCrop, AppError>> {
    const transform = estimateSimilarityTransform(landmarkPoints(detection.landmarks), sfaceTemplate);
    const transformedNose = applySimilarityTransform(transform, detection.landmarks.nose);
    if (!Number.isFinite(transformedNose.x) || !Number.isFinite(transformedNose.y)) {
      return Promise.resolve({ ok: false, error: appError('processing_error', 'Face alignment failed') });
    }
    return Promise.resolve(ok({
      frameJpegPath,
      detection,
      width: 112,
      height: 112,
    }));
  }

  async embed(alignedCrop: AlignedFaceCrop): Promise<Result<Float32Array, AppError>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    if (this.embedder === null) return { ok: false, error: appError('internal', 'Face embedder session is not loaded') };
    const inputName = this.embedder.inputNames[0] ?? 'input';
    const output = await this.runSession(this.embedder, {
      [inputName]: this.sessionFactory.tensor(emptyImage(alignedCrop.width, alignedCrop.height), [1, 3, alignedCrop.height, alignedCrop.width]),
    }, `Failed to embed face crop from ${alignedCrop.frameJpegPath}`);
    if (!output.ok) return output;
    const tensor = firstTensor(output.value);
    if (tensor === null) return { ok: false, error: appError('processing_error', 'Face embedding output is empty') };
    const values = Array.from(tensor.data).slice(0, 128);
    if (values.length !== 128) return { ok: false, error: appError('processing_error', 'Face embedding output must contain 128 values') };
    return ok(new Float32Array(normalizeEmbedding(values)));
  }

  dispose(): Promise<Result<void, AppError>> {
    this.detector = null;
    this.embedder = null;
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

const parseDetections = (outputs: Record<string, OrtTensor>): FaceDetection[] => {
  const tensor = firstTensor(outputs);
  if (tensor === null) return [];
  const width = tensor.dims.at(-1) ?? 0;
  if (width < 15) return [];
  const rows = Math.floor(Array.from(tensor.data).length / width);
  const values = Array.from(tensor.data);
  const detections: FaceDetection[] = [];
  for (let row = 0; row < rows; row += 1) {
    const offset = row * width;
    const score = values[offset + 14] ?? 0;
    const bbox = {
      x: values[offset] ?? 0,
      y: values[offset + 1] ?? 0,
      width: values[offset + 2] ?? 0,
      height: values[offset + 3] ?? 0,
    };
    if (bbox.width <= 0 || bbox.height <= 0) continue;
    detections.push({
      bbox,
      landmarks: {
        leftEye: { x: values[offset + 4] ?? 0, y: values[offset + 5] ?? 0 },
        rightEye: { x: values[offset + 6] ?? 0, y: values[offset + 7] ?? 0 },
        nose: { x: values[offset + 8] ?? 0, y: values[offset + 9] ?? 0 },
        leftMouth: { x: values[offset + 10] ?? 0, y: values[offset + 11] ?? 0 },
        rightMouth: { x: values[offset + 12] ?? 0, y: values[offset + 13] ?? 0 },
      },
      score,
    });
  }
  return detections;
};

const firstTensor = (outputs: Record<string, OrtTensor>): OrtTensor | null => {
  const first = Object.values(outputs)[0];
  return first ?? null;
};

const landmarkPoints = (landmarks: FaceLandmarks): readonly FacePoint[] => [
  landmarks.leftEye,
  landmarks.rightEye,
  landmarks.nose,
  landmarks.leftMouth,
  landmarks.rightMouth,
];

const emptyImage = (width: number, height: number): Float32Array =>
  new Float32Array(width * height * 3);

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
