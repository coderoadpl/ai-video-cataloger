/**
 * Electron GUI end-to-end test.
 *
 * Mirrors the CLI e2e scenario but exercises the whole app through the real
 * user interface: the app opens a folder, auto-scans it, the user selects the
 * video and clicks "Analyze Video", and we assert the file gets a descriptive,
 * date-prefixed name reflecting the known content - proving the GUI -> IPC ->
 * CLI -> media:// wiring works end to end. Then we confirm the rename is
 * reversible from the tool's own catalog.
 *
 * Requires: built renderer (electron/renderer/dist) + built main
 * (dist-electron), and the `claude` CLI logged in. Skips cleanly otherwise.
 * Run with `npm run test:e2e:gui`.
 */

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchAppWithVideo, REPO_ROOT, type GuiHarness } from './launch.js';
import { detectPrereqs, listVideos, readCatalog, revertRenames } from '../e2e/helpers.js';
import { SAMPLES } from '../e2e/samples.js';

const RENAMED_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;

// Big Buck Bunny: bundled in the repo, no whisper needed - fast and reliable.
const sample = SAMPLES.find((s) => s.id === 'bbb');
const sampleAbsPath = sample ? join(REPO_ROOT, 'test', 'BigBuckBunny480p30s.mp4') : '';

const prereqs = detectPrereqs();
const rendererBuilt = existsSync(join(REPO_ROOT, 'electron', 'renderer', 'dist', 'index.html'));
const mainBuilt = existsSync(join(REPO_ROOT, 'dist-electron', 'main', 'index.js'));

test.describe('Electron GUI: analyze a known video and rename it', () => {
  test.skip(!prereqs.claude, 'claude CLI not available');
  test.skip(!rendererBuilt || !mainBuilt, 'app not built - run npm run electron:build first');
  test.skip(!sample, 'bbb sample not found');

  let harness: GuiHarness | undefined;

  test.afterAll(async () => {
    if (harness) {
      await harness.app.close().catch(() => {});
      rmSync(harness.workdir, { recursive: true, force: true });
    }
  });

  test('renames the video to a content-based name through the UI', async () => {
    test.setTimeout(460_000);
    harness = await launchAppWithVideo(sampleAbsPath, sample!.file);
    const { page, workdir, videoFile } = harness;

    // The app auto-scans the pre-seeded folder; the video appears in the list.
    const originalRow = page.locator(`[data-testid="video-item"][data-video-filename="${videoFile}"]`);
    await expect(originalRow).toBeVisible({ timeout: 60_000 });

    // Select it, then start analysis from the details pane.
    await originalRow.click();
    const analyzeButton = page.getByTestId('analyze-button');
    await expect(analyzeButton).toBeVisible({ timeout: 15_000 });
    await analyzeButton.click();

    // Wait for the pipeline to finish: a row appears with a "completed" status.
    // (The list shows a spinner with zero rows during every rescan, so we key
    // on the completed row appearing, not on the original row disappearing.)
    const completedRow = page.locator('[data-testid="video-item"][data-video-status="completed"]');
    await expect(completedRow).toBeVisible({ timeout: 420_000 });

    const renamedName = await completedRow.getAttribute('data-video-filename');
    expect(renamedName, 'renamed filename should be present').toBeTruthy();
    expect(renamedName!).not.toBe(videoFile);
    expect(renamedName!, `"${renamedName}" should match YYYY-MM-DD_slug.ext`).toMatch(RENAMED_PATTERN);

    // The AI-generated name reflects the known content.
    const matched = sample!.contentKeywords.some((kw) =>
      renamedName!.toLowerCase().includes(kw.toLowerCase())
    );
    expect(
      matched,
      `renamed file "${renamedName}" mentions none of: ${sample!.contentKeywords.join(', ')}`
    ).toBe(true);
     
    console.log(`[gui] "${videoFile}" -> "${renamedName}"`);

    // On disk: exactly one video, renamed; catalog marks it completed.
    expect(listVideos(workdir)).toEqual([renamedName]);
    const rows = await readCatalog(workdir);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].original_name).toBe(videoFile);
    expect(rows[0].new_name).toBe(renamedName);

    // Rename is reversible from the tool's own catalog.
    const reverted = await revertRenames(workdir);
    expect(reverted).toBe(1);
    expect(listVideos(workdir)).toEqual([videoFile]);
  });
});
