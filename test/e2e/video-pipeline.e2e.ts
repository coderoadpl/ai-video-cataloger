/**
 * End-to-end pipeline tests on real videos with known content.
 *
 * For every sample: run the real CLI (frames -> [transcription] -> Claude
 * analysis -> rename) in an isolated temp dir, then assert:
 *   1. the run completes and the file gets a descriptive, date-prefixed name,
 *   2. the AI output matches the known content (keyword check on the new
 *      filename + summary description),
 *   3. expected artifacts exist (frames, summary, transcript when applicable),
 *   4. the rename is fully reversible from the tool's own catalog.db.
 *
 * Requirements: claude CLI logged in; ffmpeg comes bundled; local whisper is
 * optional (transcript assertions are skipped when missing). Not part of
 * `npm test` - run via `npm run test:e2e:videos` (see scripts/e2e-videos.sh
 * to run the same suite against another git ref, e.g. main or a PR branch).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  CLI_DIST, detectPrereqs, findKeyword, listVideos, makeWorkdir, readCatalog,
  revertRenames, runCli,
} from './helpers.js';
import { selectedSamples } from './samples.js';

const RENAMED_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;
const PROCESS_TIMEOUT_MS = 420_000;

const prereqs = detectPrereqs();
const samples = selectedSamples().filter(
  (sample) => sample.source.kind !== 'synthetic' || prereqs.say
);

beforeAll(() => {
  if (!existsSync(CLI_DIST)) {
    throw new Error(
      `CLI build not found at ${CLI_DIST} - run "npm run build" first, ` +
      'or point E2E_CLI_DIST at a built dist/index.js of the ref under test.'
    );
  }
  if (!prereqs.claude) {
     
    console.warn('claude CLI not available - the e2e video suite will be skipped.');
  }
  if (!prereqs.whisper) {
     
    console.warn('local whisper not available - transcript assertions will be skipped.');
  }
});

describe.each(samples)('e2e video pipeline: $id', (sample) => {
  let workdir = '';
  let originalName = '';
  let renamedName = '';

  beforeAll(async () => {
    const created = await makeWorkdir(sample);
    workdir = created.dir;
    originalName = sample.file;
  }, 240_000);

  afterAll(() => {
    if (workdir) rmSync(workdir, { recursive: true, force: true });
  });

  it(
    'processes the video and gives it a descriptive name matching the known content',
    { timeout: PROCESS_TIMEOUT_MS, skip: !prereqs.claude },
    async () => {
      const whisperMode = sample.whisper === 'local' && prereqs.whisper ? 'local' : 'skip';
      const result = await runCli(
        ['process', join(workdir, originalName), '--json', '-f', '3', '-t', '240', '-w', whisperMode],
        workdir,
        PROCESS_TIMEOUT_MS - 10_000
      );

      const errors = result.events.filter((event) => event.type === 'error');
      expect(
        result.code,
        `process exited with ${result.code}; errors: ${JSON.stringify(errors)}\nstderr: ${result.stderr.slice(-1500)}`
      ).toBe(0);
      expect(result.events.some((event) => event.type === 'completed')).toBe(true);

      // Exactly one video remains and it was renamed to a dated slug
      const videos = listVideos(workdir);
      expect(videos, `expected exactly one video in ${workdir}`).toHaveLength(1);
      renamedName = videos[0];
      expect(renamedName).not.toBe(originalName);
      expect(renamedName, `"${renamedName}" should match YYYY-MM-DD_slug.ext`).toMatch(RENAMED_PATTERN);
      expect(extname(renamedName)).toBe(extname(originalName));

      // Summary artifact exists (human-readable .txt is written on all branches)
      const base = basename(renamedName, extname(renamedName));
      const summaryPath = join(workdir, 'summaries', `${base}.txt`);
      expect(existsSync(summaryPath), `missing summary: ${summaryPath}`).toBe(true);
      const summaryText = readFileSync(summaryPath, 'utf-8');

      // The AI output must reflect the actual video content
      const matched =
        findKeyword(renamedName, sample.contentKeywords) ??
        findKeyword(summaryText, sample.contentKeywords);
      expect(
        matched,
        `AI output does not mention any expected keyword.\n` +
        `  expected any of: ${sample.contentKeywords.join(', ')}\n` +
        `  filename: ${renamedName}\n` +
        `  summary (first 400 chars): ${summaryText.slice(0, 400)}`
      ).toBeTruthy();
       
      console.log(`[${sample.id}] renamed to "${renamedName}" (matched keyword: "${matched}")`);

      // Frames were extracted
      const framesDir = join(workdir, 'frames', base);
      expect(existsSync(framesDir), `missing frames dir: ${framesDir}`).toBe(true);
      expect(readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).length).toBeGreaterThan(0);

      // Speech-bearing samples must produce a transcript with expected words
      if (sample.transcriptKeywords && whisperMode === 'local') {
        const transcriptPath = join(workdir, 'transcripts', `${base}.txt`);
        expect(existsSync(transcriptPath), `missing transcript: ${transcriptPath}`).toBe(true);
        const transcript = readFileSync(transcriptPath, 'utf-8');
        const spoken = findKeyword(transcript, sample.transcriptKeywords);
        expect(
          spoken,
          `transcript does not contain any expected word.\n` +
          `  expected any of: ${sample.transcriptKeywords.join(', ')}\n` +
          `  transcript (first 400 chars): ${transcript.slice(0, 400)}`
        ).toBeTruthy();
      }

      // Catalog reflects the completed run
      const rows = await readCatalog(workdir);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('completed');
      expect(rows[0].original_name).toBe(originalName);
      expect(rows[0].new_name).toBe(renamedName);
    }
  );

  it(
    'the rename is reversible using only the catalog the tool wrote',
    { timeout: 60_000, skip: !prereqs.claude },
    async () => {
      expect(renamedName, 'previous test must have renamed the file').not.toBe('');
      const reverted = await revertRenames(workdir);
      expect(reverted).toBe(1);
      expect(listVideos(workdir)).toEqual([originalName]);
    }
  );
});
