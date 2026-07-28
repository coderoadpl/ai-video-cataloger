import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  appError,
  configDescriptorSchema,
  type AppError,
  type ConfigDescriptor,
  type Result,
} from '@core/domain/index.js';
import {
  folderArtifactRoot,
  readOnlyArtifactRoot,
} from '@core/server/usecases/artifact-root.js';
import {
  framesKey,
  materializeSelectedVariantProjection,
  reusableFramesArtifact,
  reusableTranscriptArtifact,
  sharedArtifactPaths,
  transcriptKey,
  variantArtifactPaths,
} from '@core/server/usecases/artifact-store.js';
import { artifactPaths } from '@core/server/usecases/shared.js';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeFileSystemPort } from './index.js';

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'avc-artifacts-'));
  temporaryDirectories.push(directory);
  return directory;
};

const descriptor = (input: {
  family?: 'api' | 'local';
  frames?: number;
  providerId?: string;
} = {}): ConfigDescriptor => input.family === 'api'
  ? configDescriptorSchema.parse({
    family: 'api',
    providerId: input.providerId ?? 'openai',
    model: 'gpt-5.5',
    maxImageDetail: 'auto',
    whisper_mode: 'local',
    whisper_model: 'base',
    whisper_language: 'auto',
    frames: input.frames ?? 3,
    output_language: 'en',
    promptVersion: 1,
  })
  : configDescriptorSchema.parse({
    family: 'local',
    providerId: input.providerId ?? 'local',
    modelTag: 'gemma3:12b',
    whisper_mode: 'local',
    whisper_model: 'base',
    whisper_language: 'auto',
    frames: input.frames ?? 3,
    output_language: 'en',
    promptVersion: 1,
  });

const nativeDescriptor = configDescriptorSchema.parse({
  family: 'gemini-native',
  providerId: 'gemini',
  model: 'gemini-3.6-flash',
  output_language: 'pl',
  promptVersion: 1,
});

const writeVariant = async (
  paths: ReturnType<typeof variantArtifactPaths>,
  label: string,
): Promise<void> => {
  if (paths.framesDirectory === null) throw new Error('Expected frame artifact paths');
  await mkdir(paths.framesDirectory, { recursive: true });
  await writeFile(path.join(paths.framesDirectory, 'frame-001.jpg'), 'frame-one');
  await writeFile(path.join(paths.framesDirectory, 'frame-002.jpg'), 'frame-two');
  await writeFile(path.join(paths.framesDirectory, 'frame-003.jpg'), 'frame-three');
  await mkdir(path.dirname(paths.transcriptPath), { recursive: true });
  await writeFile(paths.transcriptPath, 'shared transcript');
  await writeFile(paths.transcriptJsonPath, '{"segments":[]}');
  await mkdir(paths.directory, { recursive: true });
  await writeFile(paths.summaryPath, `${label} summary`);
  await writeFile(paths.summaryJsonPath, `{"description":"${label}"}`);
  await writeFile(paths.debugLogPath, `${label} debug`);
};

const projectionSource = (paths: ReturnType<typeof variantArtifactPaths>) => ({
  framesDirectory: paths.framesDirectory,
  transcriptPath: paths.transcriptPath,
  transcriptJsonPath: paths.transcriptJsonPath,
  summaryPath: paths.summaryPath,
  summaryJsonPath: paths.summaryJsonPath,
  debugLogPath: paths.debugLogPath,
});

class CopyOnlyFileSystem extends NodeFileSystemPort {
  override linkFile(): Promise<Result<void, AppError>> {
    return Promise.resolve({ ok: false, error: appError('internal', 'Hard links unavailable') });
  }
}

class ProjectionInstallFailureFileSystem extends NodeFileSystemPort {
  constructor(
    options: ConstructorParameters<typeof NodeFileSystemPort>[0],
    private readonly failingTarget: string,
  ) {
    super(options);
  }

  override renamePath(from: string, to: string): Promise<Result<void, AppError>> {
    if (from.endsWith('.tmp') && to === this.failingTarget) {
      return Promise.resolve({ ok: false, error: appError('internal', 'Projection install failed') });
    }
    return super.renamePath(from, to);
  }
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { force: true, recursive: true });
});

describe('content-addressed artifact paths', () => {
  it('shares frame and transcript locations across analyzer-only variants and separates outputs', async () => {
    const folder = await makeTemporaryDirectory();
    const fs = new NodeFileSystemPort({ workingDirectory: folder, homeDirectory: path.join(folder, 'home') });
    const root = folderArtifactRoot(fs, folder);
    const local = variantArtifactPaths(fs, root, 'fingerprint-001', descriptor());
    const api = variantArtifactPaths(fs, root, 'fingerprint-001', descriptor({ family: 'api' }));

    expect(local.framesDirectory).toBe(api.framesDirectory);
    expect(local.transcriptPath).toBe(api.transcriptPath);
    expect(local.directory).not.toBe(api.directory);
    expect(local.directory).toContain(path.join('.ai-video-cataloger', 'variants', 'fingerprint-001', local.configId));
    expect(local.framesDirectory).toContain(path.join('.ai-video-cataloger', 'artifacts', 'frames', 'fingerprint-001'));

    await writeVariant(local, 'local');
    await mkdir(api.directory, { recursive: true });
    await writeFile(api.summaryPath, 'api summary');
    await writeFile(api.summaryJsonPath, '{"description":"api"}');
    await writeFile(api.debugLogPath, 'api debug');
    const legacy = artifactPaths(fs, root, path.join(folder, 'clip.mp4'), null);
    await mkdir(path.dirname(legacy.thumbnailPath), { recursive: true });
    await writeFile(legacy.thumbnailPath, 'thumbnail');

    const projected = await materializeSelectedVariantProjection(
      fs,
      root,
      path.join(folder, 'clip.mp4'),
      null,
      projectionSource(api),
    );
    expect(projected).toEqual({ ok: true, value: undefined });

    const sharedFrame = await stat(path.join(local.framesDirectory ?? '', 'frame-001.jpg'));
    const projectedFrame = await stat(path.join(legacy.framesDir, 'frame-001.jpg'));
    const sharedTranscript = await stat(local.transcriptPath);
    const projectedTranscript = await stat(legacy.transcriptPath);
    expect(projectedFrame.ino).toBe(sharedFrame.ino);
    expect(projectedTranscript.ino).toBe(sharedTranscript.ino);
    expect(sharedFrame.nlink).toBeGreaterThanOrEqual(2);
    expect(sharedTranscript.nlink).toBeGreaterThanOrEqual(2);
    await expect(readFile(legacy.summaryPath, 'utf8')).resolves.toBe('api summary');
    await expect(readFile(legacy.debugLogPath, 'utf8')).resolves.toBe('api debug');
    await expect(readFile(legacy.thumbnailPath, 'utf8')).resolves.toBe('thumbnail');
  });

  it('uses extraction settings in frame keys and transcription settings in transcript keys', () => {
    const threeFrames = descriptor({ frames: 3 });
    const fiveFrames = descriptor({ frames: 5 });
    const analyzerOnlyChange = descriptor({ family: 'api' });

    expect(framesKey(3)).toBe(framesKey(3));
    expect(framesKey(3)).not.toBe(framesKey(5));
    expect(transcriptKey(threeFrames)).toBe(transcriptKey(fiveFrames));
    expect(transcriptKey(threeFrames)).toBe(transcriptKey(analyzerOnlyChange));
    expect(transcriptKey(nativeDescriptor)).toBe('native:gemini:gemini-3.6-flash');
  });

  it('keeps different frame counts in different shared directories', async () => {
    const folder = await makeTemporaryDirectory();
    const fs = new NodeFileSystemPort({ workingDirectory: folder });
    const root = folderArtifactRoot(fs, folder);
    const three = sharedArtifactPaths(fs, root, 'fingerprint-001', descriptor({ frames: 3 }));
    const five = sharedArtifactPaths(fs, root, 'fingerprint-001', descriptor({ frames: 5 }));

    expect(three.framesDirectory).not.toBe(five.framesDirectory);
    expect(three.transcriptPath).toBe(five.transcriptPath);
  });
});

describe('artifact reuse verification', () => {
  it('requires the expected key, an existing artifact, and enough canonical frames without using mtime', async () => {
    const folder = await makeTemporaryDirectory();
    const fs = new NodeFileSystemPort({ workingDirectory: folder });
    const root = folderArtifactRoot(fs, folder);
    const paths = sharedArtifactPaths(fs, root, 'fingerprint-001', descriptor());
    if (paths.framesDirectory === null || paths.framesKey === null) throw new Error('Expected frame artifact paths');

    const missing = await reusableFramesArtifact(fs, {
      directory: paths.framesDirectory,
      expectedKey: paths.framesKey,
      requestedCount: 3,
    });
    expect(missing).toEqual({ ok: true, value: { reusable: false, framePaths: [] } });

    await mkdir(paths.framesDirectory, { recursive: true });
    await writeFile(path.join(paths.framesDirectory, 'frame-001.jpg'), 'one');
    await writeFile(path.join(paths.framesDirectory, 'frame-002.jpg'), 'two');
    await writeFile(path.join(paths.framesDirectory, 'other.jpg'), 'ignored');
    const partial = await reusableFramesArtifact(fs, {
      directory: paths.framesDirectory,
      expectedKey: paths.framesKey,
      requestedCount: 3,
    });
    expect(partial).toMatchObject({ ok: true, value: { reusable: false } });

    const thirdFrame = path.join(paths.framesDirectory, 'frame-003.jpg');
    await writeFile(thirdFrame, 'three');
    await utimes(thirdFrame, new Date(0), new Date(0));
    const complete = await reusableFramesArtifact(fs, {
      directory: paths.framesDirectory,
      expectedKey: paths.framesKey,
      requestedCount: 3,
    });
    const wrongKey = await reusableFramesArtifact(fs, {
      directory: paths.framesDirectory,
      expectedKey: framesKey(5),
      requestedCount: 3,
    });
    expect(complete).toMatchObject({ ok: true, value: { reusable: true, framePaths: expect.arrayContaining([thirdFrame]) } });
    expect(wrongKey).toEqual({ ok: true, value: { reusable: false, framePaths: [] } });

    await mkdir(path.dirname(paths.transcriptPath), { recursive: true });
    expect(await reusableTranscriptArtifact(fs, { path: paths.transcriptPath, expectedKey: paths.transcriptKey }))
      .toEqual({ ok: true, value: false });
    await writeFile(paths.transcriptPath, 'transcript');
    await utimes(paths.transcriptPath, new Date(0), new Date(0));
    expect(await reusableTranscriptArtifact(fs, { path: paths.transcriptPath, expectedKey: paths.transcriptKey }))
      .toEqual({ ok: true, value: true });
    expect(await reusableTranscriptArtifact(fs, { path: paths.transcriptPath, expectedKey: 'trx_wrong' }))
      .toEqual({ ok: true, value: false });
  });
});

describe('selected variant projection', () => {
  it('copies when hard links are unavailable', async () => {
    const folder = await makeTemporaryDirectory();
    const fs = new CopyOnlyFileSystem({ workingDirectory: folder });
    const root = folderArtifactRoot(fs, folder);
    const paths = variantArtifactPaths(fs, root, 'fingerprint-001', descriptor());
    await writeVariant(paths, 'copy');

    const projected = await materializeSelectedVariantProjection(
      fs,
      root,
      path.join(folder, 'clip.mp4'),
      null,
      projectionSource(paths),
    );
    expect(projected).toEqual({ ok: true, value: undefined });

    const legacy = artifactPaths(fs, root, path.join(folder, 'clip.mp4'), null);
    const source = await stat(paths.summaryPath);
    const copied = await stat(legacy.summaryPath);
    expect(copied.ino).not.toBe(source.ino);
    await expect(readFile(legacy.summaryPath, 'utf8')).resolves.toBe('copy summary');
  });

  it('removes stale optional projections when the selected variant has no matching input', async () => {
    const folder = await makeTemporaryDirectory();
    const fs = new NodeFileSystemPort({ workingDirectory: folder });
    const root = folderArtifactRoot(fs, folder);
    const first = variantArtifactPaths(fs, root, 'fingerprint-001', descriptor());
    const second = variantArtifactPaths(fs, root, 'fingerprint-001', descriptor({ family: 'api' }));
    await writeVariant(first, 'first');
    await mkdir(second.directory, { recursive: true });
    await writeFile(second.summaryPath, 'second summary');
    await writeFile(second.summaryJsonPath, '{"description":"second"}');
    const videoPath = path.join(folder, 'clip.mp4');
    expect(await materializeSelectedVariantProjection(fs, root, videoPath, null, projectionSource(first)))
      .toEqual({ ok: true, value: undefined });

    const projected = await materializeSelectedVariantProjection(fs, root, videoPath, null, {
      framesDirectory: null,
      transcriptPath: null,
      transcriptJsonPath: null,
      summaryPath: second.summaryPath,
      summaryJsonPath: second.summaryJsonPath,
      debugLogPath: null,
    });
    expect(projected).toEqual({ ok: true, value: undefined });

    const legacy = artifactPaths(fs, root, videoPath, null);
    await expect(fs.exists(legacy.framesDir)).resolves.toEqual({ ok: true, value: false });
    await expect(fs.exists(legacy.transcriptPath)).resolves.toEqual({ ok: true, value: false });
    await expect(fs.exists(legacy.transcriptJsonPath)).resolves.toEqual({ ok: true, value: false });
    await expect(fs.exists(legacy.debugLogPath)).resolves.toEqual({ ok: true, value: false });
    await expect(readFile(legacy.summaryPath, 'utf8')).resolves.toBe('second summary');
  });

  it('rolls every path back when installing a staged projection fails', async () => {
    const folder = await makeTemporaryDirectory();
    const normalFs = new NodeFileSystemPort({ workingDirectory: folder });
    const root = folderArtifactRoot(normalFs, folder);
    const first = variantArtifactPaths(normalFs, root, 'fingerprint-001', descriptor());
    const second = variantArtifactPaths(normalFs, root, 'fingerprint-001', descriptor({ family: 'api' }));
    await writeVariant(first, 'first');
    await writeVariant(second, 'second');
    const videoPath = path.join(folder, 'clip.mp4');
    const firstProjection = await materializeSelectedVariantProjection(normalFs, root, videoPath, null, projectionSource(first));
    expect(firstProjection).toEqual({ ok: true, value: undefined });

    const legacy = artifactPaths(normalFs, root, videoPath, null);
    const failingFs = new ProjectionInstallFailureFileSystem({ workingDirectory: folder }, legacy.summaryJsonPath);
    const failed = await materializeSelectedVariantProjection(failingFs, root, videoPath, null, projectionSource(second));

    expect(failed).toMatchObject({ ok: false, error: { message: 'Projection install failed' } });
    await expect(readFile(legacy.summaryPath, 'utf8')).resolves.toBe('first summary');
    await expect(readFile(legacy.summaryJsonPath, 'utf8')).resolves.toBe('{"description":"first"}');
    await expect(readFile(legacy.debugLogPath, 'utf8')).resolves.toBe('first debug');
  });

  it('materializes the same layout inside the read-only folder mirror', async () => {
    const folder = await makeTemporaryDirectory();
    const home = path.join(folder, 'home');
    const sourceFolder = path.join(folder, 'mounted-drive');
    const fs = new NodeFileSystemPort({ workingDirectory: folder, homeDirectory: home });
    const root = readOnlyArtifactRoot(fs, sourceFolder);
    const paths = variantArtifactPaths(fs, root, 'fingerprint-001', descriptor());
    await writeVariant(paths, 'mirror');

    const projected = await materializeSelectedVariantProjection(
      fs,
      root,
      path.join(sourceFolder, 'clip.mp4'),
      null,
      projectionSource(paths),
    );
    expect(projected).toEqual({ ok: true, value: undefined });

    const legacy = artifactPaths(fs, root, path.join(sourceFolder, 'clip.mp4'), null);
    expect(paths.directory.startsWith(root.catalogDirectory)).toBe(true);
    expect(legacy.summaryPath.startsWith(root.path)).toBe(true);
    await expect(readFile(legacy.summaryPath, 'utf8')).resolves.toBe('mirror summary');
  });
});
