import { describe, expect, it } from 'vitest';

import { OnnxFaceEngineAdapter, executionProviders, type OrtSession, type OrtSessionFactory, type OrtTensor } from './index.js';
import {
  FILE_ARTIFACTS,
  applySimilarityTransform,
  estimateSimilarityTransform,
  ok,
  type AppError,
  type FacePoint,
  type FileArtifact,
  type Result,
} from '@core/domain/index.js';
import type { ModelDownloadPort } from '@core/server/index.js';
import type { WhisperModelName } from '@core/domain/index.js';

const detectorTensor: OrtTensor = {
  data: new Float32Array([10, 20, 200, 180, 70, 90, 130, 90, 100, 120, 80, 160, 120, 160, 0.9]),
  dims: [1, 15],
};

const embedderTensor: OrtTensor = {
  data: new Float32Array(Array.from({ length: 128 }, (_value, index) => index + 1)),
  dims: [1, 128],
};

const fakeSession = (output: OrtTensor): OrtSession => ({
  inputNames: ['input'],
  outputNames: ['output'],
  run: () => Promise.resolve({ output }),
});

const fakeSessionFactory: OrtSessionFactory = {
  create: (modelPath) => Promise.resolve(fakeSession(modelPath.includes('yunet') ? detectorTensor : embedderTensor)),
  tensor: (data, dims) => ({ data, dims }),
};

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

const buildAdapter = (): OnnxFaceEngineAdapter =>
  new OnnxFaceEngineAdapter({ downloads: new StubDownloads(), sessionFactory: fakeSessionFactory });

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
});

describe('OnnxFaceEngineAdapter with a fake ort session', () => {
  it('parses detection rows from the detector output tensor', async () => {
    const adapter = buildAdapter();
    const result = await adapter.detect('/tmp/frame.jpg');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.bbox).toEqual({ x: 10, y: 20, width: 200, height: 180 });
    expect(result.value[0]?.score).toBeCloseTo(0.9, 5);
  });

  it('aligns to a 112x112 crop from landmarks', async () => {
    const adapter = buildAdapter();
    const detection = (await adapter.detect('/tmp/frame.jpg'));
    if (!detection.ok) throw new Error(detection.error.message);
    const first = detection.value[0];
    if (first === undefined) throw new Error('expected a detection');
    const aligned = await adapter.align('/tmp/frame.jpg', first);
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) throw new Error(aligned.error.message);
    expect(aligned.value.width).toBe(112);
    expect(aligned.value.height).toBe(112);
  });

  it('returns a normalized 128-dimensional embedding', async () => {
    const adapter = buildAdapter();
    const aligned = { frameJpegPath: '/tmp/frame.jpg', width: 112, height: 112, detection: {
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      landmarks: {
        leftEye: { x: 0, y: 0 }, rightEye: { x: 1, y: 0 }, nose: { x: 0, y: 1 },
        leftMouth: { x: 0, y: 0 }, rightMouth: { x: 1, y: 1 },
      },
      score: 0.9,
    } };
    const result = await adapter.embed(aligned);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(128);
    const magnitude = Math.sqrt([...result.value].reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });
});

describe('executionProviders', () => {
  it('always ends with the cpu provider', () => {
    const providers = executionProviders();
    expect(providers.at(-1)).toBe('cpu');
  });
});
