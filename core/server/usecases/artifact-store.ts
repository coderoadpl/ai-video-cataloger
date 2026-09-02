import { createHash, randomUUID } from 'node:crypto';

import {
  appError,
  configDescriptorSchema,
  configId,
  ok,
  type AppError,
  type ConfigDescriptor,
  type Result,
} from '@core/domain/index.js';
import { z } from 'zod';

import type { FileSystemPort } from '../ports.js';
import type { ArtifactRoot } from './artifact-root.js';
import { artifactPaths } from './shared.js';

const safePathSegmentSchema = z.string().min(1).regex(/^[a-zA-Z0-9._:-]+$/);
const configIdSchema = z.union([z.literal('legacy'), z.string().regex(/^cfg_[0-9a-f]{12}$/)]);
const fingerprintSchema = safePathSegmentSchema;
const frameCountSchema = z.number().int().min(1).max(10);
export const FRAME_FILE_NAME_PATTERN = /^frame-[0-9]{3}\.jpg$/;

const frameExtractionParameters = {
  format: 'jpeg',
  placement: 'evenly-spaced-interior',
  version: 1,
} as const;

const projectionSourceSchema = z.object({
  framesDirectory: z.string().min(1).nullable(),
  transcriptPath: z.string().min(1).nullable(),
  transcriptJsonPath: z.string().min(1).nullable(),
  summaryPath: z.string().min(1),
  summaryJsonPath: z.string().min(1),
  debugLogPath: z.string().min(1).nullable(),
}).strict();
const projectionAddressSchema = z.object({
  videoPath: z.string().min(1),
  newName: z.string().min(1).nullable(),
}).strict();

export interface SharedArtifactPaths {
  framesKey: string | null;
  framesDirectory: string | null;
  transcriptKey: string;
  transcriptPath: string;
  transcriptJsonPath: string;
}

export interface VariantOutputPaths {
  directory: string;
  summaryPath: string;
  summaryJsonPath: string;
  debugLogPath: string;
}

export interface VariantArtifactPaths extends SharedArtifactPaths, VariantOutputPaths {
  configId: string;
}

export type SelectedVariantProjectionSource = z.input<typeof projectionSourceSchema>;

interface ProjectionEntry {
  source: string | null;
  target: string;
  kind: 'directory' | 'file';
}

interface StagedProjectionEntry extends ProjectionEntry {
  temporary: string | null;
  backup: string;
  previousMoved: boolean;
  stagedMoved: boolean;
}

const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 12);

export const framesKey = (frameCount: number): string => {
  const count = frameCountSchema.parse(frameCount);
  return `frm_${shortHash(JSON.stringify({ frames: count, extraction: frameExtractionParameters }))}`;
};

export const transcriptKey = (input: ConfigDescriptor): string => {
  const descriptor = configDescriptorSchema.parse(input);
  if (descriptor.family === 'gemini-native') {
    return safePathSegmentSchema.parse(`native:${descriptor.providerId}:${descriptor.model}`);
  }
  if (descriptor.family === 'translation') {
    return safePathSegmentSchema.parse(`translation:${descriptor.sourceConfigId}:${descriptor.providerId}:${descriptor.model}`);
  }
  if (descriptor.whisper_mode === undefined) throw new TypeError('Parsed descriptor has no transcription mode');
  switch (descriptor.whisper_mode) {
    case 'local':
      return `trx_${shortHash(JSON.stringify({
        whisper_mode: descriptor.whisper_mode,
        whisper_model: descriptor.whisper_model,
        whisper_language: descriptor.whisper_language,
      }))}`;
    case 'api':
      return `trx_${shortHash(JSON.stringify({
        whisper_mode: descriptor.whisper_mode,
        whisper_language: descriptor.whisper_language,
        whisper_api_base_url: descriptor.whisper_api_base_url,
        whisper_api_model: descriptor.whisper_api_model,
      }))}`;
    case 'skip':
      return `trx_${shortHash(JSON.stringify({ whisper_mode: descriptor.whisper_mode }))}`;
  }
};

export const sharedArtifactPaths = (
  fs: FileSystemPort,
  root: ArtifactRoot,
  fingerprintInput: string,
  descriptorInput: ConfigDescriptor,
): SharedArtifactPaths => {
  const fingerprint = fingerprintSchema.parse(fingerprintInput);
  const descriptor = configDescriptorSchema.parse(descriptorInput);
  const resolvedTranscriptKey = transcriptKey(descriptor);
  if (descriptor.family === 'translation') {
    if (descriptor.sourceConfigId === undefined) throw new TypeError('Parsed translation descriptor has no source config id');
    const output = variantOutputPaths(fs, root, fingerprint, configId(descriptor));
    return {
      framesKey: descriptor.sourceConfigId,
      framesDirectory: fs.join(output.directory, 'frames'),
      transcriptKey: resolvedTranscriptKey,
      transcriptPath: fs.join(output.directory, 'transcript.txt'),
      transcriptJsonPath: fs.join(output.directory, 'transcript.json'),
    };
  }
  const transcriptDirectory = fs.join(root.catalogDirectory, 'artifacts', 'transcripts', fingerprint);
  if (descriptor.family === 'gemini-native') {
    return {
      framesKey: null,
      framesDirectory: null,
      transcriptKey: resolvedTranscriptKey,
      transcriptPath: fs.join(transcriptDirectory, `${resolvedTranscriptKey}.txt`),
      transcriptJsonPath: fs.join(transcriptDirectory, `${resolvedTranscriptKey}.json`),
    };
  }
  const resolvedFramesKey = framesKey(frameCountSchema.parse(descriptor.frames));
  return {
    framesKey: resolvedFramesKey,
    framesDirectory: fs.join(root.catalogDirectory, 'artifacts', 'frames', fingerprint, resolvedFramesKey),
    transcriptKey: resolvedTranscriptKey,
    transcriptPath: fs.join(transcriptDirectory, `${resolvedTranscriptKey}.txt`),
    transcriptJsonPath: fs.join(transcriptDirectory, `${resolvedTranscriptKey}.json`),
  };
};

export const variantOutputPaths = (
  fs: FileSystemPort,
  root: ArtifactRoot,
  fingerprintInput: string,
  configIdInput: string,
): VariantOutputPaths => {
  const fingerprint = fingerprintSchema.parse(fingerprintInput);
  const parsedConfigId = configIdSchema.parse(configIdInput);
  const directory = fs.join(root.catalogDirectory, 'variants', fingerprint, parsedConfigId);
  return {
    directory,
    summaryPath: fs.join(directory, 'summary.txt'),
    summaryJsonPath: fs.join(directory, 'summary.json'),
    debugLogPath: fs.join(directory, 'debug.log'),
  };
};

export const variantArtifactPaths = (
  fs: FileSystemPort,
  root: ArtifactRoot,
  fingerprint: string,
  descriptorInput: ConfigDescriptor,
): VariantArtifactPaths => {
  const descriptor = configDescriptorSchema.parse(descriptorInput);
  const resolvedConfigId = configId(descriptor);
  return {
    configId: resolvedConfigId,
    ...sharedArtifactPaths(fs, root, fingerprint, descriptor),
    ...variantOutputPaths(fs, root, fingerprint, resolvedConfigId),
  };
};

export const reusableFramesArtifact = async (
  fs: FileSystemPort,
  input: { directory: string; expectedKey: string; requestedCount: number },
): Promise<Result<{ reusable: boolean; framePaths: string[] }, AppError>> => {
  const parsed = z.object({
    directory: z.string().min(1),
    expectedKey: safePathSegmentSchema,
    requestedCount: frameCountSchema,
  }).strict().safeParse(input);
  if (!parsed.success) return invalidArtifactInput('frame reuse request', parsed.error.issues);
  if (fs.basename(parsed.data.directory) !== parsed.data.expectedKey) return ok({ reusable: false, framePaths: [] });
  const exists = await fs.isDirectory(parsed.data.directory);
  if (!exists.ok) return exists;
  if (!exists.value) return ok({ reusable: false, framePaths: [] });
  const entries = await fs.listDirectory(parsed.data.directory);
  if (!entries.ok) return entries;
  const framePaths = entries.value
    .filter((entry) => entry.kind === 'file' && FRAME_FILE_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.path)
    .sort();
  return ok({ reusable: framePaths.length >= parsed.data.requestedCount, framePaths });
};

export const reusableTranscriptArtifact = async (
  fs: FileSystemPort,
  input: { path: string; expectedKey: string },
): Promise<Result<boolean, AppError>> => {
  const parsed = z.object({
    path: z.string().min(1),
    expectedKey: safePathSegmentSchema,
  }).strict().safeParse(input);
  if (!parsed.success) return invalidArtifactInput('transcript reuse request', parsed.error.issues);
  if (fs.basenameWithoutExtension(parsed.data.path) !== parsed.data.expectedKey) return ok(false);
  return fs.isFile(parsed.data.path);
};

export interface ProjectableVariant {
  fingerprint: string;
  configId: string;
  descriptor: ConfigDescriptor | null;
}

export const variantProjectionSource = async (
  fs: FileSystemPort,
  root: ArtifactRoot,
  variant: ProjectableVariant,
): Promise<Result<SelectedVariantProjectionSource | null, AppError>> => {
  const outputs = variantOutputPaths(fs, root, variant.fingerprint, variant.configId);
  const hasSummary = await fs.isFile(outputs.summaryJsonPath);
  if (!hasSummary.ok) return hasSummary;
  if (!hasSummary.value) return ok(null);
  const debugLogPath = await optionalFile(fs, outputs.debugLogPath);
  if (!debugLogPath.ok) return debugLogPath;
  if (variant.descriptor === null) {
    return ok({
      framesDirectory: null,
      transcriptPath: null,
      transcriptJsonPath: null,
      summaryPath: outputs.summaryPath,
      summaryJsonPath: outputs.summaryJsonPath,
      debugLogPath: debugLogPath.value,
    });
  }
  const shared = sharedArtifactPaths(fs, root, variant.fingerprint, variant.descriptor);
  const transcriptPath = await optionalFile(fs, shared.transcriptPath);
  if (!transcriptPath.ok) return transcriptPath;
  const transcriptJsonPath = await optionalFile(fs, shared.transcriptJsonPath);
  if (!transcriptJsonPath.ok) return transcriptJsonPath;
  const framesDirectory = await optionalDirectory(fs, shared.framesDirectory);
  if (!framesDirectory.ok) return framesDirectory;
  return ok({
    framesDirectory: framesDirectory.value,
    transcriptPath: transcriptPath.value,
    transcriptJsonPath: transcriptJsonPath.value,
    summaryPath: outputs.summaryPath,
    summaryJsonPath: outputs.summaryJsonPath,
    debugLogPath: debugLogPath.value,
  });
};

export const selectedVariantProjectionSource = async (
  fs: FileSystemPort,
  paths: VariantArtifactPaths,
): Promise<Result<SelectedVariantProjectionSource, AppError>> => {
  const transcript = await optionalFile(fs, paths.transcriptPath);
  if (!transcript.ok) return transcript;
  const transcriptJson = await optionalFile(fs, paths.transcriptJsonPath);
  if (!transcriptJson.ok) return transcriptJson;
  const debug = await optionalFile(fs, paths.debugLogPath);
  if (!debug.ok) return debug;
  return ok({
    framesDirectory: paths.framesDirectory,
    transcriptPath: transcript.value,
    transcriptJsonPath: transcriptJson.value,
    summaryPath: paths.summaryPath,
    summaryJsonPath: paths.summaryJsonPath,
    debugLogPath: debug.value,
  });
};

export const materializeSelectedVariantProjection = async (
  fs: FileSystemPort,
  root: ArtifactRoot,
  videoPath: string,
  newName: string | null,
  sourceInput: SelectedVariantProjectionSource,
): Promise<Result<void, AppError>> => {
  const parsedSource = projectionSourceSchema.safeParse(sourceInput);
  if (!parsedSource.success) return invalidArtifactInput('selected variant projection', parsedSource.error.issues);
  const parsedAddress = projectionAddressSchema.safeParse({ videoPath, newName });
  if (!parsedAddress.success) return invalidArtifactInput('selected variant projection path', parsedAddress.error.issues);
  const source = parsedSource.data;
  const target = artifactPaths(fs, root, parsedAddress.data.videoPath, parsedAddress.data.newName);
  const entries: ProjectionEntry[] = [
    { source: source.framesDirectory, target: target.framesDir, kind: 'directory' },
    { source: source.transcriptPath, target: target.transcriptPath, kind: 'file' },
    { source: source.transcriptJsonPath, target: target.transcriptJsonPath, kind: 'file' },
    { source: source.summaryPath, target: target.summaryPath, kind: 'file' },
    { source: source.summaryJsonPath, target: target.summaryJsonPath, kind: 'file' },
    { source: source.debugLogPath, target: target.debugLogPath, kind: 'file' },
  ];
  const transactionId = randomUUID();
  const staged: StagedProjectionEntry[] = [];
  for (const entry of entries) {
    const prepared = await stageProjectionEntry(fs, entry, transactionId);
    if (!prepared.ok) {
      await cleanProjectionEntries(fs, staged);
      return prepared;
    }
    staged.push(prepared.value);
  }
  for (const entry of staged) {
    const committed = await commitProjectionEntry(fs, entry);
    if (!committed.ok) {
      await rollbackProjectionEntries(fs, staged);
      return committed;
    }
  }
  for (const entry of staged) {
    if (entry.previousMoved) await fs.deletePath(entry.backup);
  }
  return ok(undefined);
};

const stageProjectionEntry = async (
  fs: FileSystemPort,
  entry: ProjectionEntry,
  transactionId: string,
): Promise<Result<StagedProjectionEntry, AppError>> => {
  const temporary = entry.source === null ? null : `${entry.target}.projection-${transactionId}.tmp`;
  const staged = {
    ...entry,
    temporary,
    backup: `${entry.target}.projection-${transactionId}.bak`,
    previousMoved: false,
    stagedMoved: false,
  };
  if (entry.source === null || temporary === null) return ok(staged);
  const ensured = await fs.ensureDirectory(fs.dirname(temporary));
  if (!ensured.ok) return ensured;
  if (entry.kind === 'file') {
    const materialized = await materializeArtifactFile(fs, entry.source, temporary);
    if (!materialized.ok) await fs.deletePath(temporary);
    return materialized.ok ? ok(staged) : materialized;
  }
  const sourceDirectory = await fs.isDirectory(entry.source);
  if (!sourceDirectory.ok) return sourceDirectory;
  if (!sourceDirectory.value) {
    return { ok: false, error: appError('file_not_found', `Artifact directory not found: ${entry.source}`) };
  }
  const temporaryDirectory = await fs.ensureDirectory(temporary);
  if (!temporaryDirectory.ok) return temporaryDirectory;
  const sourceEntries = await fs.listDirectory(entry.source);
  if (!sourceEntries.ok) {
    await fs.deletePath(temporary);
    return sourceEntries;
  }
  for (const sourceEntry of sourceEntries.value) {
    if (sourceEntry.kind !== 'file' || !FRAME_FILE_NAME_PATTERN.test(sourceEntry.name)) continue;
    const materialized = await materializeArtifactFile(fs, sourceEntry.path, fs.join(temporary, sourceEntry.name));
    if (!materialized.ok) {
      await fs.deletePath(temporary);
      return materialized;
    }
  }
  return ok(staged);
};

export const materializeArtifactFile = async (
  fs: FileSystemPort,
  source: string,
  target: string,
): Promise<Result<void, AppError>> => {
  const sourceExists = await fs.isFile(source);
  if (!sourceExists.ok) return sourceExists;
  if (!sourceExists.value) return { ok: false, error: appError('file_not_found', `Artifact file not found: ${source}`) };
  const linked = await fs.linkFile(source, target);
  if (linked.ok) return linked;
  return fs.copyFile(source, target);
};

export const materializeTranslatedVariantArtifacts = async (
  fs: FileSystemPort,
  source: SelectedVariantProjectionSource,
  target: VariantArtifactPaths,
): Promise<Result<void, AppError>> => {
  const parsed = projectionSourceSchema.safeParse(source);
  if (!parsed.success) return invalidArtifactInput('translation artifact source', parsed.error.issues);
  const files = [
    [parsed.data.summaryPath, target.summaryPath],
    [parsed.data.summaryJsonPath, target.summaryJsonPath],
    [parsed.data.debugLogPath, target.debugLogPath],
    [parsed.data.transcriptPath, target.transcriptPath],
    [parsed.data.transcriptJsonPath, target.transcriptJsonPath],
  ] as const;
  for (const [from, to] of files) {
    if (from === null) continue;
    const ensured = await fs.ensureDirectory(fs.dirname(to));
    if (!ensured.ok) return ensured;
    const copied = await materializeArtifactFile(fs, from, to);
    if (!copied.ok) return copied;
  }
  if (parsed.data.framesDirectory === null || target.framesDirectory === null) return ok(undefined);
  const entries = await fs.listDirectory(parsed.data.framesDirectory);
  if (!entries.ok) return entries;
  const ensured = await fs.ensureDirectory(target.framesDirectory);
  if (!ensured.ok) return ensured;
  for (const entry of entries.value) {
    if (entry.kind !== 'file' || !FRAME_FILE_NAME_PATTERN.test(entry.name)) continue;
    const copied = await materializeArtifactFile(fs, entry.path, fs.join(target.framesDirectory, entry.name));
    if (!copied.ok) return copied;
  }
  return ok(undefined);
};

const commitProjectionEntry = async (
  fs: FileSystemPort,
  entry: StagedProjectionEntry,
): Promise<Result<void, AppError>> => {
  const targetExists = await fs.exists(entry.target);
  if (!targetExists.ok) return targetExists;
  if (targetExists.value) {
    const backedUp = await fs.renamePath(entry.target, entry.backup);
    if (!backedUp.ok) return backedUp;
    entry.previousMoved = true;
  }
  if (entry.temporary === null) return ok(undefined);
  const installed = await fs.renamePath(entry.temporary, entry.target);
  if (!installed.ok) return installed;
  entry.stagedMoved = true;
  return ok(undefined);
};

const rollbackProjectionEntries = async (
  fs: FileSystemPort,
  entries: readonly StagedProjectionEntry[],
): Promise<void> => {
  for (const entry of [...entries].reverse()) {
    if (entry.stagedMoved) await fs.deletePath(entry.target);
    if (entry.previousMoved) await fs.renamePath(entry.backup, entry.target);
    if (entry.temporary !== null) await fs.deletePath(entry.temporary);
  }
};

const cleanProjectionEntries = async (
  fs: FileSystemPort,
  entries: readonly StagedProjectionEntry[],
): Promise<void> => {
  for (const entry of entries) {
    if (entry.temporary !== null) await fs.deletePath(entry.temporary);
  }
};

const optionalFile = async (fs: FileSystemPort, path: string): Promise<Result<string | null, AppError>> => {
  const exists = await fs.isFile(path);
  if (!exists.ok) return exists;
  return ok(exists.value ? path : null);
};

const optionalDirectory = async (fs: FileSystemPort, path: string | null): Promise<Result<string | null, AppError>> => {
  if (path === null) return ok(null);
  const exists = await fs.isDirectory(path);
  if (!exists.ok) return exists;
  return ok(exists.value ? path : null);
};

const invalidArtifactInput = <T>(subject: string, details: unknown): Result<T, AppError> => ({
  ok: false,
  error: appError('validation', `Invalid ${subject}`, details),
});
