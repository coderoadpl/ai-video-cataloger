import { expect, test } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';

import { REAL_JPEG_BLUE, REAL_JPEG_RED } from '../fixtures/real-jpegs.js';
import { syntheticPng } from '../fixtures/synthetic-png.js';
import { makeEmptyWorkdir, runCli } from './helpers.js';
import { matrixAllowsSkip, missingLegMessage, systemOllamaModelMissingReason } from './matrix-support.js';

const CELL_TIMEOUT_MS = 1_800_000;
const CLI_TIMEOUT_MS = 900_000;
const MATRIX_MODEL = 'gemma3:4b';

test.describe.configure({ mode: 'serial' });

const cellEnvironment = (home: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN: '1',
  ...overrides,
  HOME: home,
  USERPROFILE: home,
});

const failOrSkip = (cell: string, reason: string): never => {
  const message = missingLegMessage(cell, reason);
  if (matrixAllowsSkip(process.env.E2E_MATRIX_ALLOW_SKIP)) test.skip(true, message);
  throw new Error(message);
};

const scanSummarySchema = z.object({
  media: z.literal('photo'),
  photosNew: z.number().int().nonnegative(),
  pathsSeen: z.number().int().nonnegative(),
});

const proxiesSummarySchema = z.object({
  media: z.literal('photo'),
  candidates: z.number().int().nonnegative(),
  generated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

const statusSchema = z.object({
  media: z.literal('photo'),
  counts: z.object({
    photos: z.number().int().nonnegative(),
    proxied: z.number().int().nonnegative(),
    proxyFailed: z.number().int().nonnegative(),
    analysed: z.number().int().nonnegative(),
  }),
});

const searchSchema = z.object({
  media: z.literal('photo'),
  count: z.number().int().nonnegative(),
  results: z.array(z.object({ fingerprint: z.string().min(1), fileName: z.string().min(1) })),
});

const processSchema = z.object({
  media: z.literal('photo'),
  configId: z.string().regex(/^cfg_[0-9a-f]{12}$/),
  analysed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

const completedData = (
  cell: string,
  result: { code: number; stdout: string; stderr: string; events: { type: string; data?: unknown }[] },
  step: string,
): unknown => {
  if (result.code !== 0) {
    throw new Error(`[${cell}] ${step} exited ${String(result.code)}\n${result.stdout}\n${result.stderr}`);
  }
  const completed = result.events.find((event) => event.type === 'completed');
  if (completed === undefined) throw new Error(`[${cell}] ${step} produced no completed event\n${result.stdout}`);
  return completed.data;
};

const photosWorkdir = (tag: string): string => {
  const workdir = makeEmptyWorkdir(tag);
  const photos = join(workdir, 'photos');
  mkdirSync(photos, { recursive: true });
  writeFileSync(join(photos, 'red.jpg'), REAL_JPEG_RED);
  writeFileSync(join(photos, 'blue.jpg'), REAL_JPEG_BLUE);
  return workdir;
};

const artifactCount = (home: string, kind: 'proxies' | 'thumbs'): number => {
  const directory = join(home, '.ai-video-cataloger', 'photo-artifacts', kind);
  return existsSync(directory) ? readdirSync(directory).length : 0;
};

test('photos-real-decode: scan, real proxy decode, status and search', async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const cell = 'photos-real-decode';
  if (process.platform !== 'darwin') failOrSkip(cell, `photo decode uses /usr/bin/sips; found ${process.platform}`);

  const workdir = photosWorkdir('photos-real-decode');
  const home = join(workdir, 'home');
  mkdirSync(home, { recursive: true });
  const environment = cellEnvironment(home);
  const root = join(workdir, 'photos');
  try {
    const scan = await runCli(['photos', 'scan', root, '--json'], workdir, CLI_TIMEOUT_MS, environment);
    const scanned = scanSummarySchema.parse(completedData(cell, scan, 'photos scan'));
    expect(scanned.photosNew).toBe(2);
    expect(scanned.pathsSeen).toBe(2);

    expect(artifactCount(home, 'proxies')).toBe(2);
    expect(artifactCount(home, 'thumbs')).toBe(2);
    for (const name of readdirSync(join(home, '.ai-video-cataloger', 'photo-artifacts', 'proxies'))) {
      expect(statSync(join(home, '.ai-video-cataloger', 'photo-artifacts', 'proxies', name)).size).toBeGreaterThan(0);
    }

    const proxies = await runCli(['photos', 'proxies', root, '--json'], workdir, CLI_TIMEOUT_MS, environment);
    const regenerated = proxiesSummarySchema.parse(completedData(cell, proxies, 'photos proxies'));
    expect(regenerated.failed).toBe(0);

    const status = await runCli(['photos', 'status', root, '--json'], workdir, CLI_TIMEOUT_MS, environment);
    const counts = statusSchema.parse(completedData(cell, status, 'photos status')).counts;
    expect(counts.photos).toBe(2);
    expect(counts.proxied).toBe(2);
    expect(counts.proxyFailed).toBe(0);

    const search = await runCli(['photos', 'search', 'red', '--json'], workdir, CLI_TIMEOUT_MS, environment);
    const found = searchSchema.parse(completedData(cell, search, 'photos search'));
    expect(found.results.some((entry) => entry.fileName === 'red.jpg')).toBe(true);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('photos-local-analysis: real analyzer over real proxies', async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const cell = 'photos-local-analysis';
  if (process.platform !== 'darwin') failOrSkip(cell, `photo decode uses /usr/bin/sips; found ${process.platform}`);
  const baseUrl = process.env.E2E_SYSTEM_OLLAMA_URL ?? 'http://127.0.0.1:11434';
  const reason = await systemOllamaModelMissingReason(baseUrl, MATRIX_MODEL);
  if (reason !== null) failOrSkip(cell, reason);

  const workdir = makeEmptyWorkdir('photos-local-analysis');
  const home = join(workdir, 'home');
  const root = join(workdir, 'photos');
  mkdirSync(home, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'scene.png'), syntheticPng(512));
  const environment = cellEnvironment(home, { OLLAMA_HOST: baseUrl });
  try {
    const provider = JSON.stringify({ family: 'local', providerId: 'local', modelTag: MATRIX_MODEL });
    for (const [key, value] of [['analyzer_provider', provider], ['analyzer_backend', 'local'], ['local_model', MATRIX_MODEL]]) {
      const configured = await runCli(['config', 'set', key ?? '', value ?? '', '--json'], root, 60_000, environment);
      expect(configured.code, configured.stderr).toBe(0);
    }

    const scan = await runCli(['photos', 'scan', root, '--json'], workdir, CLI_TIMEOUT_MS, environment);
    scanSummarySchema.parse(completedData(cell, scan, 'photos scan'));

    const processed = await runCli(['photos', 'process', root, '--json'], workdir, CLI_TIMEOUT_MS, environment);
    const summary = processSchema.parse(completedData(cell, processed, 'photos process'));
    expect(summary.analysed).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBe(0);

    const status = await runCli(['photos', 'status', root, '--json'], workdir, CLI_TIMEOUT_MS, environment);
    const counts = statusSchema.parse(completedData(cell, status, 'photos status')).counts;
    expect(counts.analysed).toBeGreaterThanOrEqual(1);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('photos-raw-sample: a real RAW file produces a proxy from its embedded preview', async () => {
  test.setTimeout(CELL_TIMEOUT_MS);
  const cell = 'photos-raw-sample';
  const sample = process.env.E2E_PHOTOS_SAMPLE_RAW;
  if (sample === undefined || sample.length === 0) {
    test.skip(true, 'Set E2E_PHOTOS_SAMPLE_RAW to a real RAW file to run the optional RAW decode leg');
    return;
  }
  if (!existsSync(sample)) failOrSkip(cell, `RAW sample does not exist: ${sample}`);

  const workdir = makeEmptyWorkdir('photos-raw-sample');
  const home = join(workdir, 'home');
  const root = join(workdir, 'photos');
  mkdirSync(home, { recursive: true });
  mkdirSync(root, { recursive: true });
  copyFileSync(sample, join(root, basename(sample)));
  const environment = cellEnvironment(home);
  try {
    const scan = await runCli(['photos', 'scan', root, '--json'], workdir, CLI_TIMEOUT_MS, environment);
    const scanned = scanSummarySchema.parse(completedData(cell, scan, 'photos scan'));
    expect(scanned.photosNew).toBe(1);

    const status = await runCli(['photos', 'status', root, '--json'], workdir, CLI_TIMEOUT_MS, environment);
    const counts = statusSchema.parse(completedData(cell, status, 'photos status')).counts;
    expect(counts.proxied).toBe(1);
    expect(counts.proxyFailed).toBe(0);
    expect(artifactCount(home, 'proxies')).toBe(1);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});
