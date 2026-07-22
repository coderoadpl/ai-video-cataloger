import { describe, expect, it } from 'vitest';

import {
  FILE_ARTIFACTS,
  applySimilarityTransform,
  estimateSimilarityTransform,
  ok,
  type AppError,
  type FaceLandmarks,
  type FacePoint,
  type FileArtifact,
  type Result,
} from '@core/domain/index.js';
import type { AlignedFaceCrop, FaceDetection, ModelDownloadPort } from '@core/server/index.js';
import type { RgbFrame } from '@adapters/ffmpeg/index.js';
import type { WhisperModelName } from '@core/domain/index.js';

import {
  OnnxFaceEngineAdapter,
  SFACE_ALIGNMENT_TEMPLATE,
  createSFaceTensor,
  createYuNetTensor,
  decodeYuNetOutputs,
  executionProviders,
  faceAlignmentSource,
  nonMaxSuppression,
  parseDetections,
  warpAlignedFaceRgb,
  type FaceImageIO,
  type LetterboxMeta,
  type OrtSession,
  type OrtSessionFactory,
  type OrtTensor,
} from './index.js';

const onePixelFrame = (r: number, g: number, b: number): RgbFrame => ({
  width: 1,
  height: 1,
  data: new Uint8Array([r, g, b]),
});

const detectorOutputs = (): Record<string, OrtTensor> => {
  const outputs: Record<string, OrtTensor> = {};
  for (const stride of [8, 16, 32]) {
    const cells = (640 / stride) * (640 / stride);
    outputs[`cls_${stride}`] = { data: new Float32Array(cells), dims: [1, cells, 1] };
    outputs[`obj_${stride}`] = { data: new Float32Array(cells), dims: [1, cells, 1] };
    outputs[`bbox_${stride}`] = { data: new Float32Array(cells * 4), dims: [1, cells, 4] };
    outputs[`kps_${stride}`] = { data: new Float32Array(cells * 10), dims: [1, cells, 10] };
  }
  const stride = 8;
  const cols = 640 / stride;
  const row = 15;
  const col = 20;
  const anchor = row * cols + col;
  const cls = outputs.cls_8;
  const obj = outputs.obj_8;
  const bbox = outputs.bbox_8;
  const kps = outputs.kps_8;
  if (cls === undefined || obj === undefined || bbox === undefined || kps === undefined) throw new Error('missing heads');
  const clsData = tensorData(cls);
  const objData = tensorData(obj);
  const bboxData = tensorData(bbox);
  const kpsData = tensorData(kps);
  clsData[anchor] = 0.95;
  objData[anchor] = 0.95;
  const boxOffset = anchor * 4;
  bboxData[boxOffset] = 0.5;
  bboxData[boxOffset + 1] = 0.5;
  bboxData[boxOffset + 2] = Math.log(48 / stride);
  bboxData[boxOffset + 3] = Math.log(40 / stride);
  const landmarkOffset = anchor * 10;
  const landmarks = [
    [0.2, 0.1],
    [0.8, 0.1],
    [0.5, 0.5],
    [0.3, 0.8],
    [0.7, 0.8],
  ];
  landmarks.forEach((point, index) => {
    kpsData[landmarkOffset + index * 2] = point[0] ?? 0;
    kpsData[landmarkOffset + index * 2 + 1] = point[1] ?? 0;
  });
  return outputs;
};

const embedderTensor = (value: 'ramp' | 'zero' = 'ramp'): OrtTensor => ({
  data: new Float32Array(Array.from({ length: 128 }, (_item, index) => (value === 'zero' ? 0 : index + 1))),
  dims: [1, 128],
});

const tensorData = (tensor: OrtTensor): Float32Array => {
  if (tensor.data instanceof Float32Array) return tensor.data;
  throw new Error('expected Float32Array');
};

const fakeSession = (run: OrtSession['run']): OrtSession => ({
  inputNames: ['input'],
  outputNames: ['output'],
  run,
});

const fakeImageIO = (frame: RgbFrame): FaceImageIO => ({
  decodeFrameRgb: () => Promise.resolve(ok(frame)),
  encodeJpeg: () => Promise.resolve(ok(undefined)),
});

const fakeSessionFactory = (
  detectorRun: OrtSession['run'],
  embedderOutput: OrtTensor = embedderTensor(),
): OrtSessionFactory => ({
  create: (modelPath) => Promise.resolve(
    fakeSession(modelPath.includes('yunet') ? detectorRun : () => Promise.resolve({ output: embedderOutput })),
  ),
  tensor: (data, dims) => ({ data, dims }),
});

class StubDownloads implements ModelDownloadPort {
  whisperModelPath(model: WhisperModelName): string {
    return `/models/${model}.bin`;
  }

  isWhisperModelDownloaded(): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(false));
  }

  downloadWhisperModel(): Promise<Result<{ model: WhisperModelName; path: string; downloaded: boolean; skipped: boolean }, AppError>> {
    return Promise.resolve(ok({ model: 'base', path: '/models/base.bin', downloaded: false, skipped: true }));
  }

  deleteWhisperModel(): Promise<Result<{ model: WhisperModelName; path: string; deleted: boolean }, AppError>> {
    return Promise.resolve(ok({ model: 'base', path: '/models/base.bin', deleted: false }));
  }

  fileArtifactPath(artifact: FileArtifact): string {
    return `/models/artifacts/${artifact.filename}`;
  }

  isFileArtifactDownloaded(): Promise<Result<boolean, AppError>> {
    return Promise.resolve(ok(true));
  }

  downloadFileArtifact(
    artifact: FileArtifact,
  ): Promise<Result<{ artifactId: FileArtifact['id']; path: string; downloaded: boolean; skipped: boolean }, AppError>> {
    return Promise.resolve(ok({ artifactId: artifact.id, path: this.fileArtifactPath(artifact), downloaded: true, skipped: false }));
  }
}

const buildAdapter = (inputFrame: RgbFrame, detectorRun: OrtSession['run'], embedderOutput = embedderTensor()): OnnxFaceEngineAdapter =>
  new OnnxFaceEngineAdapter({
    downloads: new StubDownloads(),
    sessionFactory: fakeSessionFactory(detectorRun, embedderOutput),
    imageIO: fakeImageIO(inputFrame),
  });

describe('registry entries are pinned', () => {
  it('pins the YuNet detector artifact', () => {
    expect(FILE_ARTIFACTS['face-detector/yunet-2023mar']).toEqual({
      id: 'face-detector/yunet-2023mar',
      filename: 'face_detection_yunet_2023mar.onnx',
      bytes: 232589,
      sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
      url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
      license: 'MIT',
    });
  });

  it('pins the SFace embedder artifact by sha256 without a fabricated byte size', () => {
    const embedder = FILE_ARTIFACTS['face-embedder/sface-2021dec'];
    expect(embedder.sha256).toBe('0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79');
    expect(embedder.url).toBe('https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx');
    expect(embedder.license).toBe('Apache-2.0');
  });
});

describe('pixel preprocessing', () => {
  it('pins YuNet input as BGR NCHW float values without normalization', () => {
    const prepared = createYuNetTensor(onePixelFrame(10, 20, 30));
    const plane = 640 * 640;
    expect(prepared.tensor[0]).toBe(30);
    expect(prepared.tensor[plane]).toBe(20);
    expect(prepared.tensor[2 * plane]).toBe(10);
    expect(prepared.meta).toMatchObject({ scale: 640, offsetX: 0, offsetY: 0, resizedWidth: 640, resizedHeight: 640 });
  });

  it('pins SFace input as RGB NCHW float values without normalization', () => {
    const tensor = createSFaceTensor(onePixelFrame(11, 22, 33));
    expect([...tensor]).toEqual([11, 22, 33]);
  });

  it('letterboxes wide frames and maps OpenCV rows back to source coordinates', () => {
    const meta: LetterboxMeta = {
      sourceWidth: 640,
      sourceHeight: 320,
      targetWidth: 320,
      targetHeight: 320,
      resizedWidth: 320,
      resizedHeight: 160,
      offsetX: 0,
      offsetY: 80,
      scale: 0.5,
    };
    const detections = parseDetections({
      output: {
        data: new Float32Array([160, 120, 80, 40, 170, 130, 190, 130, 180, 140, 172, 155, 188, 155, 0.9]),
        dims: [1, 15],
      },
    }, meta);
    expect(detections[0]?.bbox).toEqual({ x: 320, y: 80, width: 160, height: 80 });
    expect(detections[0]?.landmarks.nose).toEqual({ x: 360, y: 120 });
    expect(detections[0]?.landmarks.rightEye).toEqual({ x: 340, y: 100 });
    expect(detections[0]?.landmarks.leftEye).toEqual({ x: 380, y: 100 });
    expect(detections[0]?.landmarks.rightMouth).toEqual({ x: 344, y: 150 });
    expect(detections[0]?.landmarks.leftMouth).toEqual({ x: 376, y: 150 });
  });

  it('warps with bilinear sampling on a synthetic gradient', () => {
    const frame: RgbFrame = {
      width: 2,
      height: 2,
      data: new Uint8Array([
        0, 0, 0,
        100, 0, 0,
        200, 0, 0,
        255, 0, 0,
      ]),
    };
    const warped = warpAlignedFaceRgb(frame, { a: 1, b: 0, tx: -0.5, ty: -0.5 }, 1, 1);
    expect(warped[0]).toBe(139);
    expect(warped[1]).toBe(0);
    expect(warped[2]).toBe(0);
  });
});

describe('YuNet postprocessing', () => {
  const meta: LetterboxMeta = {
    sourceWidth: 640,
    sourceHeight: 640,
    targetWidth: 640,
    targetHeight: 640,
    resizedWidth: 640,
    resizedHeight: 640,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  };

  it('decodes strided heads into boxes, landmarks, and scores', () => {
    const detections = decodeYuNetOutputs(detectorOutputs(), meta, 0.7, 0.3);
    expect(detections).toHaveLength(1);
    expect(detections[0]?.score).toBeCloseTo(0.95, 5);
    expect(detections[0]?.bbox.x).toBeCloseTo(140, 5);
    expect(detections[0]?.bbox.y).toBeCloseTo(104, 5);
    expect(detections[0]?.bbox.width).toBeCloseTo(48, 5);
    expect(detections[0]?.landmarks.rightEye.x).toBeCloseTo(161.6, 5);
    expect(detections[0]?.landmarks.leftEye.x).toBeCloseTo(166.4, 5);
  });

  it('suppresses overlapping detections by IoU', () => {
    const detections: FaceDetection[] = [
      detection({ x: 0, y: 0, width: 100, height: 100 }, 0.9),
      detection({ x: 10, y: 10, width: 100, height: 100 }, 0.8),
      detection({ x: 220, y: 220, width: 40, height: 40 }, 0.7),
    ];
    const kept = nonMaxSuppression(detections, 0.3);
    expect(kept.map((item) => item.score)).toEqual([0.9, 0.7]);
  });
});

describe('similarity transform alignment', () => {
  const template: readonly FacePoint[] = [
    { x: 38.2946, y: 51.6963 },
    { x: 73.5318, y: 51.5014 },
    { x: 56.0252, y: 71.7366 },
    { x: 41.5493, y: 92.3655 },
    { x: 70.7299, y: 92.2041 },
  ];

  it('is the identity when source equals target', () => {
    const transform = estimateSimilarityTransform(template, template);
    for (const point of template) {
      const mapped = applySimilarityTransform(transform, point);
      expect(mapped.x).toBeCloseTo(point.x, 4);
      expect(mapped.y).toBeCloseTo(point.y, 4);
    }
  });

  it('recovers a known translation from source landmarks to the template', () => {
    const source = template.map((point) => ({ x: point.x - 12, y: point.y + 7 }));
    const transform = estimateSimilarityTransform(source, template);
    for (let index = 0; index < source.length; index += 1) {
      const mapped = applySimilarityTransform(transform, source[index] ?? { x: 0, y: 0 });
      expect(mapped.x).toBeCloseTo(template[index]?.x ?? 0, 3);
      expect(mapped.y).toBeCloseTo(template[index]?.y ?? 0, 3);
    }
  });

  const templateLandmarks: FaceLandmarks = {
    rightEye: SFACE_ALIGNMENT_TEMPLATE[0] ?? { x: 0, y: 0 },
    leftEye: SFACE_ALIGNMENT_TEMPLATE[1] ?? { x: 0, y: 0 },
    nose: SFACE_ALIGNMENT_TEMPLATE[2] ?? { x: 0, y: 0 },
    rightMouth: SFACE_ALIGNMENT_TEMPLATE[3] ?? { x: 0, y: 0 },
    leftMouth: SFACE_ALIGNMENT_TEMPLATE[4] ?? { x: 0, y: 0 },
  };

  const reprojectionError = (landmarks: FaceLandmarks): number => {
    const source = faceAlignmentSource(landmarks);
    const transform = estimateSimilarityTransform(source, SFACE_ALIGNMENT_TEMPLATE);
    return SFACE_ALIGNMENT_TEMPLATE.reduce((worst, target) => {
      const matched = source[SFACE_ALIGNMENT_TEMPLATE.indexOf(target)] ?? { x: 0, y: 0 };
      const mapped = applySimilarityTransform(transform, matched);
      return Math.max(worst, Math.hypot(mapped.x - target.x, mapped.y - target.y));
    }, 0);
  };

  it('yields a near-identity transform when landmarks sit on the reference template positions', () => {
    expect(reprojectionError(templateLandmarks)).toBeLessThan(1e-6);
  });

  it('does not yield an identity transform when the eyes are swapped', () => {
    const swappedEyes: FaceLandmarks = {
      ...templateLandmarks,
      rightEye: templateLandmarks.leftEye,
      leftEye: templateLandmarks.rightEye,
    };
    expect(reprojectionError(swappedEyes)).toBeGreaterThan(5);
  });
});

describe('OnnxFaceEngineAdapter with fake ort sessions', () => {
  it('feeds real decoded pixels to the detector and parses detections', async () => {
    let inputSum = 0;
    const adapter = buildAdapter(onePixelFrame(10, 20, 30), (feeds) => {
      const input = feeds.input;
      if (input === undefined) throw new Error('missing input');
      inputSum = Array.from(input.data).reduce((sum, value) => sum + Number(value), 0);
      return Promise.resolve(detectorOutputs());
    });

    const result = await adapter.detect('/tmp/frame.jpg');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(inputSum).toBeGreaterThan(0);
    expect(result.value).toHaveLength(1);
  });

  it('reuses direct video RGB decode for alignment when a fallback frame path is provided', async () => {
    const decodedInputs: string[] = [];
    const imageIO: FaceImageIO = {
      decodeFrameRgb: (input) => {
        decodedInputs.push(input.kind === 'image-path' ? input.frameJpegPath : `${input.videoPath}@${input.timestampS}`);
        return Promise.resolve(ok({
          width: 160,
          height: 160,
          data: new Uint8Array(160 * 160 * 3).fill(12),
        }));
      },
      encodeJpeg: () => Promise.resolve(ok(undefined)),
    };
    const adapter = new OnnxFaceEngineAdapter({
      downloads: new StubDownloads(),
      sessionFactory: fakeSessionFactory(() => Promise.resolve(detectorOutputs())),
      imageIO,
    });
    const detected = await adapter.detect({
      kind: 'video-timestamp',
      videoPath: '/tmp/video.mp4',
      timestampS: 2,
      fallbackFrameJpegPath: '/tmp/frame.jpg',
    });
    expect(detected.ok).toBe(true);
    if (!detected.ok) throw new Error(detected.error.message);
    const aligned = await adapter.align('/tmp/frame.jpg', centeredDetection());
    expect(aligned.ok).toBe(true);
    expect(decodedInputs).toEqual(['/tmp/video.mp4@2']);
  });

  it('aligns to a real 112x112 RGB crop and writes it through image IO', async () => {
    const writes: string[] = [];
    const imageIO: FaceImageIO = {
      decodeFrameRgb: () => Promise.resolve(ok({
        width: 160,
        height: 160,
        data: new Uint8Array(Array.from({ length: 160 * 160 * 3 }, (_item, index) => index % 251)),
      })),
      encodeJpeg: (_frame, outputPath) => {
        writes.push(outputPath);
        return Promise.resolve(ok(undefined));
      },
    };
    const adapter = new OnnxFaceEngineAdapter({
      downloads: new StubDownloads(),
      sessionFactory: fakeSessionFactory(() => Promise.resolve(detectorOutputs())),
      imageIO,
    });
    const aligned = await adapter.align('/tmp/frame.jpg', centeredDetection());
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) throw new Error(aligned.error.message);
    expect(aligned.value.data).toHaveLength(112 * 112 * 3);
    expect(aligned.value.data?.some((value) => value !== 0)).toBe(true);
    const written = await adapter.writeCrop(aligned.value, '/tmp/crop.jpg');
    expect(written.ok).toBe(true);
    expect(writes).toEqual(['/tmp/crop.jpg']);
  });

  it('returns a normalized 128-dimensional embedding and guards zero-norm output', async () => {
    const aligned: AlignedFaceCrop = { frameJpegPath: '/tmp/frame.jpg', width: 112, height: 112, detection: centeredDetection(), data: new Uint8Array(112 * 112 * 3).fill(1) };
    const adapter = buildAdapter(onePixelFrame(1, 2, 3), () => Promise.resolve(detectorOutputs()));
    const result = await adapter.embed(aligned);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(128);
    const magnitude = Math.sqrt([...result.value].reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 5);

    const zeroAdapter = buildAdapter(onePixelFrame(1, 2, 3), () => Promise.resolve(detectorOutputs()), embedderTensor('zero'));
    const zero = await zeroAdapter.embed(aligned);
    expect(zero.ok).toBe(true);
    if (!zero.ok) throw new Error(zero.error.message);
    expect([...zero.value].every((value) => value === 0)).toBe(true);
  });
});

describe('executionProviders', () => {
  it('always ends with the cpu provider', () => {
    const providers = executionProviders();
    expect(providers.at(-1)).toBe('cpu');
  });
});

const centeredDetection = (): FaceDetection => ({
  bbox: { x: 40, y: 40, width: 80, height: 80 },
  landmarks: {
    leftEye: { x: 65, y: 75 },
    rightEye: { x: 95, y: 75 },
    nose: { x: 80, y: 92 },
    leftMouth: { x: 68, y: 112 },
    rightMouth: { x: 92, y: 112 },
  },
  score: 0.95,
});

const detection = (bbox: FaceDetection['bbox'], score: number): FaceDetection => ({
  bbox,
  landmarks: centeredDetection().landmarks,
  score,
});
