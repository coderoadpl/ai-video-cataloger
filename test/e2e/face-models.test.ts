import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fileArtifactPath } from '../../adapters/whisper/index.js';
import { appError, ok, type AppError, type FileArtifact, type FileArtifactId, type Result } from '../../core/domain/index.js';
import { e2eFaceModelsCacheDirectory, ensureE2eFaceModels, type FaceModelDownloader, type FaceModelsFs } from './face-models.js';
import { scratchDirectory } from './helpers.js';

class MemoryFaceModelsFs implements FaceModelsFs {
  readonly files = new Map<string, Buffer>();

  async copyFile(source: string, target: string): Promise<void> {
    const content = this.files.get(source);
    if (content === undefined) throw missingFile(source);
    this.files.set(target, Buffer.from(content));
  }

  async mkdir(path: string, options: { recursive: true }): Promise<void> {
    void path;
    void options;
    await Promise.resolve();
  }

  async readFile(filePath: string): Promise<Buffer> {
    const content = this.files.get(filePath);
    if (content === undefined) throw missingFile(filePath);
    return Buffer.from(content);
  }

  async stat(filePath: string): Promise<{ size: number }> {
    const content = this.files.get(filePath);
    if (content === undefined) throw missingFile(filePath);
    return { size: content.length };
  }

  write(filePath: string, content: Buffer): void {
    this.files.set(filePath, Buffer.from(content));
  }
}

class FakeFaceModelDownloader implements FaceModelDownloader {
  readonly downloads: FileArtifactId[] = [];

  constructor(
    private readonly cacheHome: string,
    private readonly fs: MemoryFaceModelsFs,
    private readonly payloads: ReadonlyMap<FileArtifactId, Buffer>,
  ) {}

  fileArtifactPath(artifact: FileArtifact): string {
    return join(this.cacheHome, '.ai-video-cataloger', 'models', ...artifact.id.split('/'), artifact.filename);
  }

  async downloadFileArtifact(
    artifact: FileArtifact,
    options: { force: boolean },
  ): Promise<Result<{ artifactId: FileArtifactId; path: string; downloaded: boolean; skipped: boolean; sizeBytes?: number }, AppError>> {
    void options;
    const payload = this.payloads.get(artifact.id);
    if (payload === undefined) {
      return { ok: false, error: appError('download_error', `Missing fake payload for ${artifact.id}`) };
    }
    this.downloads.push(artifact.id);
    const artifactPath = this.fileArtifactPath(artifact);
    await this.fs.mkdir(dirname(artifactPath), { recursive: true });
    this.fs.write(artifactPath, payload);
    return ok({ artifactId: artifact.id, path: artifactPath, downloaded: true, skipped: false, sizeBytes: payload.length });
  }
}

const detectorBytes = Buffer.from('detector-ok');
const embedderBytes = Buffer.from('embedder-ok');
const detectorShaMismatchBytes = Buffer.from('detector-no');
const cacheHome = '/scratch/face-models';
const isolatedHome = '/isolated-home';

const sha256 = (content: Buffer): string =>
  createHash('sha256').update(content).digest('hex');

const modelArtifact = (
  id: FileArtifactId,
  filename: string,
  content: Buffer,
  license: string,
): FileArtifact => ({
  id,
  filename,
  bytes: content.length,
  sha256: sha256(content),
  url: `https://example.invalid/${filename}`,
  license,
});

const detectorArtifact = modelArtifact('face-detector/yunet-2023mar', 'detector.onnx', detectorBytes, 'MIT');
const embedderArtifact = modelArtifact('face-embedder/sface-2021dec', 'embedder.onnx', embedderBytes, 'Apache-2.0');
const artifacts: readonly FileArtifact[] = [
  detectorArtifact,
  embedderArtifact,
];

const payloads = new Map<FileArtifactId, Buffer>([
  ['face-detector/yunet-2023mar', detectorBytes],
  ['face-embedder/sface-2021dec', embedderBytes],
]);

const seedCache = (
  fs: MemoryFaceModelsFs,
  downloader: FakeFaceModelDownloader,
  artifact: FileArtifact,
  content: Buffer,
): void => {
  fs.write(downloader.fileArtifactPath(artifact), content);
};

const expectInstalled = async (fs: MemoryFaceModelsFs, artifact: FileArtifact, content: Buffer): Promise<void> => {
  await expect(fs.readFile(fileArtifactPath(isolatedHome, artifact))).resolves.toEqual(content);
};

describe('e2e face model fixture cache', () => {
  it('resolves the cache directory from the live process environment', () => {
    const result = e2eFaceModelsCacheDirectory(process.env);

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toBe(join(scratchDirectory(process.env), 'face-models'));
  });

  it('copies from a verified cache without downloading', async () => {
    const fs = new MemoryFaceModelsFs();
    const downloader = new FakeFaceModelDownloader(cacheHome, fs, payloads);
    seedCache(fs, downloader, detectorArtifact, detectorBytes);
    seedCache(fs, downloader, embedderArtifact, embedderBytes);

    const result = await ensureE2eFaceModels({ homeDirectory: isolatedHome, cacheDirectory: cacheHome, artifacts }, {
      fs,
      downloader,
    });

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.downloadAttempts).toBe(0);
    expect(downloader.downloads).toEqual([]);
    await expectInstalled(fs, detectorArtifact, detectorBytes);
    await expectInstalled(fs, embedderArtifact, embedderBytes);
  });

  it('downloads absent artifacts into the cache before copying', async () => {
    const fs = new MemoryFaceModelsFs();
    const downloader = new FakeFaceModelDownloader(cacheHome, fs, payloads);

    const result = await ensureE2eFaceModels({ homeDirectory: isolatedHome, cacheDirectory: cacheHome, artifacts }, {
      fs,
      downloader,
    });

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.downloadAttempts).toBe(2);
    expect(downloader.downloads).toEqual(['face-detector/yunet-2023mar', 'face-embedder/sface-2021dec']);
    await expectInstalled(fs, detectorArtifact, detectorBytes);
    await expectInstalled(fs, embedderArtifact, embedderBytes);
  });

  it('re-downloads a cached artifact when the SHA-256 does not match', async () => {
    const fs = new MemoryFaceModelsFs();
    const downloader = new FakeFaceModelDownloader(cacheHome, fs, payloads);
    seedCache(fs, downloader, detectorArtifact, detectorShaMismatchBytes);
    seedCache(fs, downloader, embedderArtifact, embedderBytes);

    const result = await ensureE2eFaceModels({ homeDirectory: isolatedHome, cacheDirectory: cacheHome, artifacts }, {
      fs,
      downloader,
    });

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.downloadAttempts).toBe(1);
    expect(downloader.downloads).toEqual(['face-detector/yunet-2023mar']);
    await expectInstalled(fs, detectorArtifact, detectorBytes);
    await expectInstalled(fs, embedderArtifact, embedderBytes);
  });
});

function missingFile(filePath: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' });
}
