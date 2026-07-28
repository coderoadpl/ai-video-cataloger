import { test as base, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';

import { analyzerCliFlags } from './analyzer-mode.js';
import { CliDriver } from './drivers/cli-driver.js';
import { GuiDriver } from './drivers/gui-driver.js';
import type { PipelineDriver } from './drivers/types.js';
import {
  addCorruptVideoTo,
  addSampleTo,
  completedData,
  createPreFeatureInstallationFixture,
  findKeyword,
  listVideos,
  makeEmptyWorkdir,
  parseScanOutput,
  parseStatusOutput,
  readCatalog,
  revertRenames,
  runCli,
  type CliResult,
} from './helpers.js';
import { SAMPLES, selectedSamples, type VideoSample } from './samples.js';

const RENAMED_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;
const configIdSchema = z.string().regex(/^cfg_[0-9a-f]{12}$/);
const processCompletionSchema = z.object({
  configId: configIdSchema,
  selectedConfigId: z.union([configIdSchema, z.literal('legacy')]),
  path: z.string(),
});
const variantRowSchema = z.object({
  configId: z.union([configIdSchema, z.literal('legacy')]),
  descriptor: z.unknown().nullable(),
  selected: z.boolean(),
  createdAt: z.string(),
  analyzer: z.string().nullable(),
  model: z.string().nullable(),
});
const variantsCompletionSchema = z.object({
  fingerprint: z.string().min(1),
  count: z.number().int().nonnegative(),
});
const searchCompletionSchema = z.object({
  count: z.number().int().nonnegative(),
  results: z.array(z.object({
    fingerprint: z.string(),
    variantCount: z.number().int().positive(),
    description: z.string().nullable(),
  }).passthrough()),
}).passthrough();
const indexRebuildSchema = z.object({
  reconciledFolders: z.number().int().nonnegative(),
  importedFiles: z.number().int().nonnegative(),
}).passthrough();
const summaryArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().min(1),
  suggestedFilename: z.string().min(1),
  fullAnalysis: z.string(),
  tags: z.array(z.string()),
  analyzedAt: z.string(),
}).passthrough();

interface Fixtures {
  driver: PipelineDriver;
  workdir: string;
}

const test = base.extend<Fixtures>({
  driver: async ({}, use, testInfo) => {
    const driver: PipelineDriver = testInfo.project.name === 'gui' ? new GuiDriver() : new CliDriver();
    await use(driver);
    await driver.close();
  },
  workdir: async ({}, use, testInfo) => {
    const dir = makeEmptyWorkdir(testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
});

async function expectProcessedOnDisk(
  workdir: string,
  originalName: string,
  contentKeywords: string[],
  transcriptKeywords?: string[],
): Promise<string> {
  const videos = listVideos(workdir);
  expect(videos, `expected exactly one video in ${workdir}`).toHaveLength(1);
  const renamedName = videos[0];
  expect(renamedName).not.toBe(originalName);
  expect(renamedName, `"${renamedName}" should match YYYY-MM-DD_slug.ext`).toMatch(RENAMED_PATTERN);
  expect(extname(renamedName)).toBe(extname(originalName));

  const baseName = basename(renamedName, extname(renamedName));
  const summaryPath = join(workdir, 'summaries', `${baseName}.txt`);
  expect(existsSync(summaryPath), `missing summary: ${summaryPath}`).toBe(true);
  const summaryText = readFileSync(summaryPath, 'utf-8');

  const matched = findKeyword(renamedName, contentKeywords) ?? findKeyword(summaryText, contentKeywords);
  expect(
    matched,
    `AI output does not mention any expected keyword.\n` +
      `expected any of: ${contentKeywords.join(', ')}\n` +
      `filename: ${renamedName}\n` +
      `summary: ${summaryText.slice(0, 400)}`,
  ).toBeTruthy();

  const framesDir = join(workdir, 'frames', baseName);
  expect(existsSync(framesDir), `missing frames dir: ${framesDir}`).toBe(true);
  expect(readdirSync(framesDir).filter((file) => file.endsWith('.jpg')).length).toBeGreaterThan(0);

  if (transcriptKeywords !== undefined) {
    const transcriptPath = join(workdir, 'transcripts', `${baseName}.txt`);
    expect(existsSync(transcriptPath), `missing transcript: ${transcriptPath}`).toBe(true);
    const transcript = readFileSync(transcriptPath, 'utf-8');
    expect(
      findKeyword(transcript, transcriptKeywords),
      `transcript has none of: ${transcriptKeywords.join(', ')}\ntranscript: ${transcript.slice(0, 400)}`,
    ).toBeTruthy();
  }

  const rows = await readCatalog(workdir);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe('completed');
  expect(rows[0]?.original_name).toBe(originalName);
  expect(rows[0]?.new_name).toBe(renamedName);
  return renamedName;
}

function sampleById(id: string): VideoSample {
  const sample = SAMPLES.find((candidate) => candidate.id === id);
  if (sample === undefined) throw new Error(`Missing sample: ${id}`);
  return sample;
}

function expectCliSuccess(result: CliResult, label: string): void {
  const errors = result.events
    .filter((event) => event.type === 'error')
    .map((event) => event.message ?? event.error ?? event.code ?? 'unknown error');
  expect(result.code, `${label}: ${errors.join(' | ')}\n${result.stderr}`).toBe(0);
}

function variantRows(result: CliResult): z.output<typeof variantRowSchema>[] {
  return result.jsonValues.flatMap((value) => {
    const parsed = variantRowSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

for (const sample of selectedSamples()) {
  test(`S1 happy path [${sample.id}]: content-based rename, artifacts, reversibility`, async ({ driver, workdir }) => {
    test.setTimeout(600_000);
    await addSampleTo(workdir, sample);
    await driver.open(workdir);

    const outcome = await driver.analyze(sample.file, { whisper: sample.whisper });
    expect(outcome.ok, `pipeline failed: ${outcome.errors.join(' | ')}`).toBe(true);

    const renamedName = await expectProcessedOnDisk(
      workdir,
      sample.file,
      sample.contentKeywords,
      sample.transcriptKeywords,
    );

    console.log(`[${driver.kind}/${sample.id}] "${sample.file}" -> "${renamedName}"`);
    expect(await revertRenames(workdir)).toBe(1);
    expect(listVideos(workdir)).toEqual([sample.file]);
  });
}

test('S2 corrupt video: pipeline fails, file untouched, no false completed', async ({ driver, workdir }) => {
  test.setTimeout(300_000);
  const corruptName = addCorruptVideoTo(workdir);
  await driver.open(workdir);

  const outcome = await driver.analyze(corruptName, { whisper: 'skip' });
  expect(outcome.ok, 'a corrupt file must not be reported as processed').toBe(false);

  expect(listVideos(workdir)).toEqual([corruptName]);
  const rows = await readCatalog(workdir);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).not.toBe('completed');
  expect(rows[0]?.new_name).toBeNull();
  expect(existsSync(join(workdir, 'summaries'))).toBe(false);
});

test('S3 cancel mid-run: no rename, then re-analyze completes', async ({ driver, workdir }) => {
  test.setTimeout(600_000);
  const bbb = sampleById('bbb');
  await addSampleTo(workdir, bbb);
  await driver.open(workdir);

  await driver.analyzeAndCancel(bbb.file, 1_500, { whisper: bbb.whisper });

  expect(listVideos(workdir)).toEqual([bbb.file]);
  const rowsAfterCancel = await readCatalog(workdir);
  for (const row of rowsAfterCancel) {
    expect(row.status).not.toBe('completed');
    expect(row.new_name).toBeNull();
  }

  const outcome = await driver.analyze(bbb.file, { whisper: bbb.whisper });
  expect(outcome.ok, `re-analyze after cancel failed: ${outcome.errors.join(' | ')}`).toBe(true);
  const videos = listVideos(workdir);
  expect(videos).toHaveLength(1);
  expect(videos[0]).toMatch(RENAMED_PATTERN);
  const rows = await readCatalog(workdir);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe('completed');
});

test('S4 batch: good videos complete, corrupt one fails, queue continues', async ({ driver, workdir }) => {
  test.setTimeout(900_000);
  const bbb = sampleById('bbb');
  const jellyfish = sampleById('jellyfish');
  await addSampleTo(workdir, bbb);
  await addSampleTo(workdir, jellyfish);
  const corruptName = addCorruptVideoTo(workdir);
  await driver.open(workdir);

  const { success, failed } = await driver.analyzeAll({ whisper: 'skip' });
  expect(success, 'both healthy videos should complete').toBe(2);
  expect(failed, 'the corrupt video should fail without stopping the batch').toBe(1);

  const videos = listVideos(workdir);
  expect(videos).toHaveLength(3);
  expect(videos).toContain(corruptName);
  const renamed = videos.filter((video) => video !== corruptName);
  for (const name of renamed) {
    expect(name, `"${name}" should match YYYY-MM-DD_slug.ext`).toMatch(RENAMED_PATTERN);
  }
  const rows = await readCatalog(workdir);
  expect(rows.filter((row) => row.status === 'completed')).toHaveLength(2);
  expect(rows.find((row) => row.original_name === corruptName)?.status).not.toBe('completed');
});

test('S5 pre-feature installation migrates, searches, resumes, and renames', async ({ workdir }, testInfo) => {
  test.skip(testInfo.project.name !== 'cli', 'CLI-only old-data compatibility scenario');
  test.setTimeout(420_000);
  const fixture = await createPreFeatureInstallationFixture(workdir);

  const searchBefore = await runCli(['search', 'skyline', '--json'], workdir);
  expectCliSuccess(searchBefore, 'pre-feature search');
  const searchBeforeData = searchCompletionSchema.parse(completedData(searchBefore));
  expect(searchBeforeData.results).toEqual([
    expect.objectContaining({
      fingerprint: fixture.fingerprint,
      variantCount: 1,
      description: fixture.analysisDescription,
    }),
  ]);

  const variantsBefore = await runCli(['variants', 'list', fixture.analyzedPath, '--json'], workdir);
  expectCliSuccess(variantsBefore, 'pre-feature variants');
  expect(variantsCompletionSchema.parse(completedData(variantsBefore))).toMatchObject({
    fingerprint: fixture.fingerprint,
    count: 1,
  });
  expect(variantRows(variantsBefore)).toEqual([
    expect.objectContaining({ configId: 'legacy', descriptor: null, selected: true }),
  ]);
  expect(readFileSync(join(workdir, 'summaries', 'legacy-catalog.json'), 'utf8')).toContain(fixture.analysisDescription);
  expect(readFileSync(join(workdir, 'transcripts', 'legacy-catalog.txt'), 'utf8')).toBe(fixture.analysisTranscript);

  const rebuild = await runCli(['index', 'rebuild', '--json'], workdir);
  expectCliSuccess(rebuild, 'pre-feature snapshot rebuild');
  expect(indexRebuildSchema.parse(completedData(rebuild))).toMatchObject({ reconciledFolders: 1, importedFiles: 1 });

  const scanBefore = await runCli(['scan', workdir, '--json'], workdir);
  expect(scanBefore.code).toBe(0);
  const scanData = parseScanOutput(completedData(scanBefore));
  expect(scanData.summary).toMatchObject({ total: 2, tracked: 2, completed: 1, error: 1 });
  expect(scanData.videos.find((video) => video.filename === fixture.resumeName)).toMatchObject({
    filename: fixture.resumeName,
    status: 'error',
    artifacts: {
      transcriptPath: join(workdir, 'transcripts', 'legacy-resume.txt'),
      newFilename: null,
    },
  });
  expect(scanData.videos[0]?.artifacts.framePaths).toHaveLength(1);

  const statusBefore = await runCli(['status', '--json'], workdir);
  expect(statusBefore.code).toBe(0);
  const statusData = parseStatusOutput(completedData(statusBefore));
  expect(statusData.summary).toMatchObject({ total: 2, completed: 1, error: 1 });
  expect(statusData.videos.find((video) => video.originalName === fixture.resumeName)).toMatchObject({
    originalName: fixture.resumeName,
    newName: null,
    status: 'error',
  });

  const resume = await runCli(
    ['process', join(workdir, fixture.resumeName), '--json', '--whisper', 'skip', ...analyzerCliFlags()],
    workdir,
    420_000,
  );
  expectCliSuccess(resume, 'pre-feature resume');
  expect(resume.events.some((event) => event.type === 'completed')).toBe(true);

  const rows = await readCatalog(workdir);
  expect(rows).toHaveLength(2);
  const resumed = rows.find((row) => row.original_name === fixture.resumeName);
  expect(resumed?.status).toBe('completed');
  expect(resumed?.new_name).toMatch(RENAMED_PATTERN);
  if (resumed?.new_name === null || resumed?.new_name === undefined) throw new Error('Legacy resume did not rename the video');
  expect(listVideos(workdir)).toEqual([fixture.analyzedName, resumed.new_name].sort());

  const variantsAfter = await runCli(['variants', 'list', fixture.analyzedPath, '--json'], workdir);
  expectCliSuccess(variantsAfter, 'post-resume legacy variants');
  expect(variantRows(variantsAfter)).toEqual([
    expect.objectContaining({ configId: 'legacy', descriptor: null, selected: true }),
  ]);
  const searchedAfter = await runCli(['search', 'skyline', '--json'], workdir);
  expectCliSuccess(searchedAfter, 'post-resume legacy search');
  const searchAfter = searchCompletionSchema.parse(completedData(searchedAfter));
  expect(searchAfter.results[0]).toMatchObject({
    fingerprint: fixture.fingerprint,
    variantCount: 1,
    description: fixture.analysisDescription,
  });
});

test('S6 two configurations share a transcript and switch selected search and artifacts', async ({ workdir }, testInfo) => {
  test.skip(testInfo.project.name !== 'cli', 'CLI-only variant scenario');
  test.setTimeout(1_200_000);
  const sample = sampleById('sintel');
  await addSampleTo(workdir, sample);
  const videoPath = join(workdir, sample.file);
  const processArgs = [
    'process',
    videoPath,
    '--frames',
    '1',
    '--skip-rename',
    '--whisper',
    'local',
    '--json',
    ...analyzerCliFlags(),
  ];

  const first = await runCli(processArgs, workdir, 600_000);
  expectCliSuccess(first, 'configuration A');
  const firstCompletion = processCompletionSchema.parse(completedData(first));

  const language = await runCli(['config', 'set', 'output_language', 'pl', '--json'], workdir);
  expectCliSuccess(language, 'configuration B language');
  const second = await runCli([...processArgs, '--verbose'], workdir, 600_000);
  expectCliSuccess(second, 'configuration B');
  const secondCompletion = processCompletionSchema.parse(completedData(second));
  expect(secondCompletion.configId).not.toBe(firstCompletion.configId);
  expect(secondCompletion.selectedConfigId).toBe(firstCompletion.configId);

  const listed = await runCli(['variants', 'list', videoPath, '--json'], workdir);
  expectCliSuccess(listed, 'two variants');
  const listing = variantsCompletionSchema.parse(completedData(listed));
  expect(listing.count).toBe(2);
  expect(variantRows(listed)).toEqual(expect.arrayContaining([
    expect.objectContaining({ configId: firstCompletion.configId, selected: true }),
    expect.objectContaining({ configId: secondCompletion.configId, selected: false }),
  ]));

  const variantsRoot = join(workdir, '.ai-video-cataloger', 'variants', listing.fingerprint);
  const firstSummaryPath = join(variantsRoot, firstCompletion.configId, 'summary.json');
  const secondSummaryPath = join(variantsRoot, secondCompletion.configId, 'summary.json');
  const firstSummaryText = readFileSync(firstSummaryPath, 'utf8');
  const secondSummaryText = readFileSync(secondSummaryPath, 'utf8');
  const firstSummary = summaryArtifactSchema.parse(JSON.parse(firstSummaryText));
  const secondSummary = summaryArtifactSchema.parse(JSON.parse(secondSummaryText));
  expect(firstSummary.description).not.toBe(secondSummary.description);
  expect(firstSummaryText).not.toBe(secondSummaryText);

  const sharedTranscriptDirectory = join(
    workdir,
    '.ai-video-cataloger',
    'artifacts',
    'transcripts',
    listing.fingerprint,
  );
  expect(readdirSync(sharedTranscriptDirectory).filter((name) => name.endsWith('.txt'))).toHaveLength(1);

  const projectionPath = join(workdir, 'summaries', `${basename(sample.file, extname(sample.file))}.json`);
  expect(readFileSync(projectionPath, 'utf8')).toBe(firstSummaryText);
  const searchedFirst = await runCli(['search', 'searching', '--json'], workdir);
  expectCliSuccess(searchedFirst, 'search configuration A');
  const searchFirst = searchCompletionSchema.parse(completedData(searchedFirst));
  expect(searchFirst.results[0]).toMatchObject({
    fingerprint: listing.fingerprint,
    variantCount: 2,
    description: firstSummary.description,
  });

  const selected = await runCli([
    'variants',
    'select',
    videoPath,
    '--config',
    secondCompletion.configId,
    '--json',
  ], workdir);
  expectCliSuccess(selected, 'select configuration B');
  expect(readFileSync(projectionPath, 'utf8')).toBe(secondSummaryText);
  const searchedSecond = await runCli(['search', 'searching', '--json'], workdir);
  expectCliSuccess(searchedSecond, 'search configuration B');
  const searchSecond = searchCompletionSchema.parse(completedData(searchedSecond));
  expect(searchSecond.results[0]).toMatchObject({
    fingerprint: listing.fingerprint,
    variantCount: 2,
    description: secondSummary.description,
  });
});
