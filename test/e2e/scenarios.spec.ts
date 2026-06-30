/**
 * Shared end-to-end scenarios, executed IDENTICALLY against two drivers:
 *   --project=cli  -> CliDriver (spawns the real binary per command)
 *   --project=gui  -> GuiDriver (clicks the real Electron app)
 *
 * Every assertion about outcomes reads the shared on-disk truth (files +
 * catalog.db), so both surfaces are held to exactly the same contract:
 *   S1 happy path per known-content sample (+ reversibility),
 *   S2 corrupt video fails safely without renaming,
 *   S3 cancel mid-run leaves no rename and the video can be re-analyzed,
 *   S4 batch of several videos continues past a failure.
 *
 * Preflight (globalSetup) HARD-fails when claude auth / whisper / builds are
 * missing - a green run always means the pipeline really executed.
 */

import { test as base, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  addCorruptVideoTo, addSampleTo, findKeyword, listVideos, makeEmptyWorkdir,
  readCatalog, revertRenames,
} from './helpers.js';
import { SAMPLES, selectedSamples } from './samples.js';
import { CliDriver } from './drivers/cli-driver.js';
import { GuiDriver } from './drivers/gui-driver.js';
import type { PipelineDriver } from './drivers/types.js';

const RENAMED_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;

interface Fixtures {
  driver: PipelineDriver;
  workdir: string;
}

const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  driver: async ({}, use, testInfo) => {
    const driver: PipelineDriver =
      testInfo.project.name === 'gui' ? new GuiDriver() : new CliDriver();
    await use(driver);
    await driver.close();
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  workdir: async ({}, use, testInfo) => {
    const dir = makeEmptyWorkdir(testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
});

/** Shared disk-level assertions for a successfully processed video. */
async function expectProcessedOnDisk(
  workdir: string,
  originalName: string,
  contentKeywords: string[],
  transcriptKeywords?: string[]
): Promise<string> {
  const videos = listVideos(workdir);
  expect(videos, `expected exactly one video in ${workdir}`).toHaveLength(1);
  const renamedName = videos[0];
  expect(renamedName).not.toBe(originalName);
  expect(renamedName, `"${renamedName}" should match YYYY-MM-DD_slug.ext`).toMatch(RENAMED_PATTERN);
  expect(extname(renamedName)).toBe(extname(originalName));

  const base = basename(renamedName, extname(renamedName));
  const summaryPath = join(workdir, 'summaries', `${base}.txt`);
  expect(existsSync(summaryPath), `missing summary: ${summaryPath}`).toBe(true);
  const summaryText = readFileSync(summaryPath, 'utf-8');

  const matched =
    findKeyword(renamedName, contentKeywords) ?? findKeyword(summaryText, contentKeywords);
  expect(
    matched,
    `AI output does not mention any expected keyword.\n` +
    `  expected any of: ${contentKeywords.join(', ')}\n` +
    `  filename: ${renamedName}\n` +
    `  summary (first 400 chars): ${summaryText.slice(0, 400)}`
  ).toBeTruthy();

  const framesDir = join(workdir, 'frames', base);
  expect(existsSync(framesDir), `missing frames dir: ${framesDir}`).toBe(true);
  expect(readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).length).toBeGreaterThan(0);

  if (transcriptKeywords) {
    const transcriptPath = join(workdir, 'transcripts', `${base}.txt`);
    expect(existsSync(transcriptPath), `missing transcript: ${transcriptPath}`).toBe(true);
    const transcript = readFileSync(transcriptPath, 'utf-8');
    expect(
      findKeyword(transcript, transcriptKeywords),
      `transcript has none of: ${transcriptKeywords.join(', ')}\n` +
      `  transcript (first 400 chars): ${transcript.slice(0, 400)}`
    ).toBeTruthy();
  }

  const rows = await readCatalog(workdir);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('completed');
  expect(rows[0].original_name).toBe(originalName);
  expect(rows[0].new_name).toBe(renamedName);
  return renamedName;
}

// ---------------------------------------------------------------------------
// S1: happy path - every known-content sample, plus rename reversibility
// ---------------------------------------------------------------------------
for (const sample of selectedSamples()) {
  test(`S1 happy path [${sample.id}]: content-based rename, artifacts, reversibility`, async ({ driver, workdir }) => {
    test.setTimeout(600_000);
    await addSampleTo(workdir, sample);
    await driver.open(workdir);

    const outcome = await driver.analyze(sample.file);
    expect(outcome.ok, `pipeline failed: ${outcome.errors.join(' | ')}`).toBe(true);

    const renamedName = await expectProcessedOnDisk(
      workdir, sample.file, sample.contentKeywords, sample.transcriptKeywords
    );
     
    console.log(`[${driver.kind}/${sample.id}] "${sample.file}" -> "${renamedName}"`);

    // Reversal using only the catalog the tool wrote
    expect(await revertRenames(workdir)).toBe(1);
    expect(listVideos(workdir)).toEqual([sample.file]);
  });
}

// ---------------------------------------------------------------------------
// S2: corrupt video fails safely - no rename, no bogus success
// ---------------------------------------------------------------------------
test('S2 corrupt video: pipeline fails, file untouched, no false completed', async ({ driver, workdir }) => {
  test.setTimeout(300_000);
  const corruptName = addCorruptVideoTo(workdir);
  await driver.open(workdir);

  const outcome = await driver.analyze(corruptName);
  expect(outcome.ok, 'a corrupt file must not be reported as processed').toBe(false);

  // File untouched, nothing renamed, catalog does not claim success
  expect(listVideos(workdir)).toEqual([corruptName]);
  const rows = await readCatalog(workdir);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).not.toBe('completed');
  expect(rows[0].new_name).toBeNull();
  expect(existsSync(join(workdir, 'summaries'))).toBe(false);
});

// ---------------------------------------------------------------------------
// S3: cancel mid-run - no rename, then a re-run completes (recovery)
// ---------------------------------------------------------------------------
test('S3 cancel mid-run: no rename, then re-analyze completes', async ({ driver, workdir }) => {
  test.setTimeout(600_000);
  const bbb = SAMPLES.find((s) => s.id === 'bbb')!;
  await addSampleTo(workdir, bbb);
  await driver.open(workdir);

  await driver.analyzeAndCancel(bbb.file, 1_500);

  // Cancelled: original file intact, nothing marked completed
  expect(listVideos(workdir)).toEqual([bbb.file]);
  const rowsAfterCancel = await readCatalog(workdir);
  for (const row of rowsAfterCancel) {
    expect(row.status).not.toBe('completed');
    expect(row.new_name).toBeNull();
  }

  // Recovery: the same video can be analyzed to completion afterwards
  const outcome = await driver.analyze(bbb.file);
  expect(outcome.ok, `re-analyze after cancel failed: ${outcome.errors.join(' | ')}`).toBe(true);
  const videos = listVideos(workdir);
  expect(videos).toHaveLength(1);
  expect(videos[0]).toMatch(RENAMED_PATTERN);
  const rows = await readCatalog(workdir);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('completed');
});

// ---------------------------------------------------------------------------
// S4: batch of several videos - failures don't stop the queue
// ---------------------------------------------------------------------------
test('S4 batch: good videos complete, corrupt one fails, queue continues', async ({ driver, workdir }) => {
  test.setTimeout(900_000);
  const bbb = SAMPLES.find((s) => s.id === 'bbb')!;
  const jellyfish = SAMPLES.find((s) => s.id === 'jellyfish')!;
  await addSampleTo(workdir, bbb);
  await addSampleTo(workdir, jellyfish);
  const corruptName = addCorruptVideoTo(workdir);
  await driver.open(workdir);

  const { success, failed } = await driver.analyzeAll();
  expect(success, 'both healthy videos should complete').toBe(2);
  expect(failed, 'the corrupt video should fail without stopping the batch').toBe(1);

  // Disk truth: two renamed videos, corrupt one untouched
  const videos = listVideos(workdir);
  expect(videos).toHaveLength(3);
  expect(videos).toContain(corruptName);
  const renamed = videos.filter((v) => v !== corruptName);
  for (const name of renamed) {
    expect(name, `"${name}" should match YYYY-MM-DD_slug.ext`).toMatch(RENAMED_PATTERN);
  }
  const rows = await readCatalog(workdir);
  expect(rows.filter((r) => r.status === 'completed')).toHaveLength(2);
  expect(rows.find((r) => r.original_name === corruptName)?.status).not.toBe('completed');
});
