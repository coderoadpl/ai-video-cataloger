import { test as base, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { analyzerCliFlags } from './analyzer-mode.js';
import { CliDriver } from './drivers/cli-driver.js';
import { GuiDriver } from './drivers/gui-driver.js';
import type { PipelineDriver } from './drivers/types.js';
import {
  addCorruptVideoTo,
  addSampleTo,
  completedData,
  createOldDataCompatFixture,
  findKeyword,
  listVideos,
  makeEmptyWorkdir,
  parseScanOutput,
  parseStatusOutput,
  readCatalog,
  revertRenames,
  runCli,
} from './helpers.js';
import { SAMPLES, selectedSamples, type VideoSample } from './samples.js';

const RENAMED_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;

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

test('S5 old-data compat: CLI reads old schema and resumes from artifacts', async ({ workdir }, testInfo) => {
  test.skip(testInfo.project.name !== 'cli', 'CLI-only old-data compatibility scenario');
  test.setTimeout(420_000);
  const originalName = await createOldDataCompatFixture(workdir);

  const scanBefore = await runCli(['scan', workdir, '--json'], workdir);
  expect(scanBefore.code).toBe(0);
  const scanData = parseScanOutput(completedData(scanBefore));
  expect(scanData.summary).toMatchObject({ total: 1, tracked: 1, error: 1 });
  expect(scanData.videos[0]).toMatchObject({
    filename: originalName,
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
  expect(statusData.summary).toMatchObject({ total: 1, error: 1 });
  expect(statusData.videos[0]).toMatchObject({
    originalName,
    newName: null,
    status: 'error',
  });

  const resume = await runCli(
    ['process', join(workdir, originalName), '--json', '--whisper', 'skip', ...analyzerCliFlags()],
    workdir,
    420_000,
  );
  const errors = resume.events.filter((event) => event.type === 'error').map((event) => event.message ?? event.code ?? 'unknown error');
  expect(resume.code, errors.join(' | ')).toBe(0);
  expect(resume.events.some((event) => event.type === 'completed')).toBe(true);

  const rows = await readCatalog(workdir);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe('completed');
  expect(rows[0]?.original_name).toBe(originalName);
  expect(rows[0]?.new_name).toMatch(RENAMED_PATTERN);
  expect(listVideos(workdir)).toEqual([rows[0]?.new_name]);
});
