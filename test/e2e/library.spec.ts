import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '../../adapters/db/index.js';
import { derivedFolderId, type AppError, type Result } from '../../core/domain/index.js';
import { REAL_JPEG_RED_LARGE } from '../fixtures/real-jpegs.js';
import { E2E_ANALYZER, E2E_LOCAL_MODEL } from './analyzer-mode.js';
import { ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, makeWorkdir, RENDERER_HTML, REPO_ROOT, runCli, stubOpenDialog } from './helpers.js';
import { SAMPLES } from './samples.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

const SPEECH_SAMPLE = SAMPLES.find((sample) => sample.id === 'speech');
if (SPEECH_SAMPLE === undefined) throw new Error('speech sample missing from SAMPLES');

const expectResult = <T>(result: Result<T, AppError>): asserts result is { ok: true; value: T } => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
};

const seedFolderPhoto = async (workdir: string): Promise<{
  fingerprint: string;
  videoFingerprint: string;
  folderId: string;
  folderLabel: string;
}> => {
  const homeDirectory = isolatedHome(workdir);
  const folderPath = join(workdir, 'selected-folder');
  const folderLabel = 'Selected Folder';
  const folderId = '70707070-7070-4070-8070-707070707070';
  const photoFolderId = derivedFolderId(folderPath);
  const fingerprint = 'ph_7000000000000001';
  const fileName = 'folder-photo.jpg';
  const photoPath = join(folderPath, fileName);
  const videoFingerprint = 'video-folder-filter';
  const videoName = 'folder-video.mp4';
  const timestamp = '2026-08-16T12:00:00.000Z';
  const videoTimestamp = '2026-08-17T12:00:00.000Z';
  mkdirSync(folderPath, { recursive: true });
  writeFileSync(photoPath, REAL_JPEG_RED_LARGE);
  writeFileSync(join(folderPath, videoName), Buffer.from([0]));

  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory });
  const photos = new SqlJsPhotosStore({ homeDirectory });
  try {
    expectResult(await globalCatalog.upsertFolder({
      folderId,
      currentPath: folderPath,
      displayName: folderLabel,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    }));
    expectResult(await globalCatalog.upsertFile({
      fingerprint: videoFingerprint,
      folderId,
      fileName: videoName,
      size: 1,
      durationS: null,
      width: null,
      height: null,
      gpsLat: null,
      gpsLon: null,
      processedAt: timestamp,
      analyzer: 'harness',
      model: 'claude-code',
      missingAt: null,
      capturedAt: videoTimestamp,
      capturedAtSource: 'container',
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      place: null,
    }));
    expectResult(await globalCatalog.upsertAnalysis({
      fingerprint: videoFingerprint,
      finalName: null,
      description: 'A video sharing the photo folder.',
      transcript: null,
      language: 'en',
      tags: [],
    }));
    expectResult(await photos.upsertFolder({
      folderId: photoFolderId,
      currentPath: folderPath,
      displayName: folderLabel,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      defaultConfigId: null,
    }));
    expectResult(await photos.upsertPhoto({
      fingerprint,
      folderId: photoFolderId,
      fileName,
      currentPath: photoPath,
      ext: 'jpg',
      size: REAL_JPEG_RED_LARGE.length,
      width: 1600,
      height: 1200,
      orientation: 1,
      cameraMake: null,
      cameraModel: null,
      lens: null,
      iso: null,
      fNumber: null,
      exposureTime: null,
      exifRating: null,
      capturedAt: timestamp,
      capturedAtSource: 'file_mtime',
      gpsLat: null,
      gpsLon: null,
      gpsSource: null,
      gpsAccuracyM: null,
      gpsIntervalKind: null,
      gpsResolvedAt: null,
      placeName: null,
      placeRegion: null,
      placeCountry: null,
      placeCountryCode: null,
      placeDistanceM: null,
      placeDataset: null,
      discoveredAt: timestamp,
      exifReadAt: timestamp,
      proxyState: 'pending',
      proxyWidth: null,
      proxyHeight: null,
      thumbState: 'pending',
      missingAt: null,
      selectedConfigId: null,
    }));
    expectResult(await photos.upsertAnalysisConfig({
      configId: 'cfg_707070707070',
      descriptorJson: JSON.stringify({ family: 'harness', providerId: 'claude-code', output_language: 'en' }),
      label: 'harness · claude-code · en',
      now: timestamp,
    }));
    expectResult(await photos.recordPhotoAnalysis({
      fingerprint,
      configId: 'cfg_707070707070',
      description: 'A photo used to verify the Library folder filter.',
      scene: 'object',
      quality: 'good',
      language: 'en',
      analyzer: 'harness',
      model: 'claude-code',
      batchSize: 1,
      usageJson: null,
      tags: [],
      createdAt: timestamp,
    }));
  } finally {
    expectResult(await photos.dispose());
    expectResult(await globalCatalog.dispose());
  }

  return { fingerprint, videoFingerprint, folderId, folderLabel };
};

const seedUnavailableVideo = async (workdir: string): Promise<{
  availableFingerprint: string;
  unavailableFingerprint: string;
}> => {
  const homeDirectory = isolatedHome(workdir);
  const onlineFolderPath = join(workdir, 'mounted-folder');
  const offlineFolderPath = join(workdir, 'unplugged-drive');
  const timestamp = '2026-08-16T12:00:00.000Z';
  const availableFingerprint = 'video-available';
  const unavailableFingerprint = 'video-unavailable';
  mkdirSync(onlineFolderPath, { recursive: true });

  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory });
  try {
    const folders = [
      { folderId: '80808080-8080-4080-8080-808080808080', currentPath: onlineFolderPath, displayName: 'Mounted Folder' },
      { folderId: '81818181-8181-4181-8181-818181818181', currentPath: offlineFolderPath, displayName: 'Unplugged Drive' },
    ];
    for (const folder of folders) {
      expectResult(await globalCatalog.upsertFolder({ ...folder, firstSeenAt: timestamp, lastSeenAt: timestamp }));
    }
    const videos = [
      { fingerprint: availableFingerprint, folderId: folders[0]?.folderId ?? '', fileName: 'mounted.mp4', capturedAt: '2026-08-17T12:00:00.000Z' },
      { fingerprint: unavailableFingerprint, folderId: folders[1]?.folderId ?? '', fileName: 'unplugged.mp4', capturedAt: '2026-08-16T12:00:00.000Z' },
    ];
    for (const video of videos) {
      writeFileSync(join(onlineFolderPath, video.fileName), Buffer.from([0]));
      expectResult(await globalCatalog.upsertFile({
        fingerprint: video.fingerprint,
        folderId: video.folderId,
        fileName: video.fileName,
        size: 1,
        durationS: null,
        width: null,
        height: null,
        gpsLat: null,
        gpsLon: null,
        processedAt: timestamp,
        analyzer: 'harness',
        model: 'claude-code',
        missingAt: null,
        capturedAt: video.capturedAt,
        capturedAtSource: 'container',
        gpsSource: null,
        gpsAccuracyM: null,
        gpsIntervalKind: null,
        gpsResolvedAt: null,
        place: null,
      }));
      expectResult(await globalCatalog.upsertAnalysis({
        fingerprint: video.fingerprint,
        finalName: null,
        description: `A clip named ${video.fileName}.`,
        transcript: null,
        language: 'en',
        tags: [],
      }));
    }
  } finally {
    expectResult(await globalCatalog.dispose());
  }

  return { availableFingerprint, unavailableFingerprint };
};

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-library-userdata-'));
  mkdirSync(userDataDir, { recursive: true });

  const app = await electron.launch({
    args: [ELECTRON_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AVC_RENDERER_HTML: RENDERER_HTML,
      AVC_HOME_DIRECTORY: isolatedHome(workdir),
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.desktopBridge !== undefined);

  const wizard = page.getByTestId('setup-wizard');
  if (await wizard.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByTestId('wizard-configure-later').click();
    await wizard.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  return { app, page };
}

test.describe('Library: same-session visibility, search, and subtitled preview', () => {
  test('an analyzed clip is searchable and previewable with subtitles in the same session', async () => {
    const { dir: workdir } = await makeWorkdir(SPEECH_SAMPLE);
    const filename = SPEECH_SAMPLE.file;

    if (E2E_ANALYZER === 'local') {
      const setBackend = await runCli(['config', 'set', 'analyzer_backend', 'local', '--json'], workdir);
      const setModel = await runCli(['config', 'set', 'local_model', E2E_LOCAL_MODEL, '--json'], workdir);
      if (setBackend.code !== 0 || setModel.code !== 0) {
        throw new Error('Failed to preset local analyzer config for the GUI library leg');
      }
    }

    const session = await launch(workdir);
    try {
      const analysisTab = session.page.getByTestId('mode-analysis');
      await expect(analysisTab).toBeVisible({ timeout: 15_000 });
      await analysisTab.click();
      await expect(analysisTab).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

      await stubOpenDialog(session.app, workdir);
      const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
      await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
      await openFolderButton.click();
      const row = session.page.locator(`[data-testid="video-item"][data-video-filename="${filename}"]`);
      await expect(row).toBeVisible({ timeout: 60_000 });

      await session.page.getByTestId('open-settings-button').click();
      const modal = session.page.getByTestId('settings-modal');
      await expect(modal).toBeVisible({ timeout: 15_000 });
      const whisperSelect = session.page.getByTestId('whisper-mode-select');
      await expect(whisperSelect).toBeVisible({ timeout: 15_000 });
      await whisperSelect.click();
      await session.page.getByTestId('whisper-mode-option-local').click();
      const saveButton = session.page.getByTestId('settings-save');
      if (await saveButton.isEnabled()) {
        await saveButton.click();
        await expect(session.page.getByTestId('saved-snackbar')).toBeVisible({ timeout: 15_000 });
      } else {
        await session.page.getByTestId('settings-cancel').click();
      }
      await expect(modal).toBeHidden({ timeout: 15_000 });

      await row.click();
      const analyzeButton = session.page.getByTestId('analyze-button');
      await expect(analyzeButton).toBeVisible({ timeout: 15_000 });
      await analyzeButton.click();
      await expect(session.page.getByTestId('analysis-state')).toHaveAttribute('data-analyzing', 'true', { timeout: 15_000 });
      await expect(session.page.getByTestId('analysis-state')).toHaveAttribute('data-analyzing', 'false', { timeout: 420_000 });

      const detail = session.page.getByTestId('detail-layout');
      await expect(detail).toBeVisible({ timeout: 15_000 });
      await expect(detail).toHaveAttribute('data-video-status', 'completed', { timeout: 15_000 });

      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-collection').click();

      const searchInput = session.page.getByTestId('library-search-input');
      await expect(searchInput).toBeVisible({ timeout: 15_000 });
      await searchInput.locator('input').fill('pasta');

      const tile = session.page.getByTestId('library-tile').first();
      await expect(tile).toBeVisible({ timeout: 20_000 });
      await tile.click();

      const viewer = session.page.getByTestId('library-media-viewer');
      await expect(viewer).toBeVisible({ timeout: 15_000 });
      await expect(viewer).toHaveAttribute('data-media', 'video');
      const player = session.page.getByTestId('library-media-viewer-player');
      await expect(player).toBeVisible({ timeout: 15_000 });
      const subtitles = player.getByTestId('library-media-viewer-subtitles-track');
      await expect(subtitles).toHaveCount(1, { timeout: 15_000 });
      await expect(subtitles).toHaveAttribute('kind', 'subtitles');

      const details = session.page.getByTestId('library-media-viewer-details');
      await expect(details).toBeVisible({ timeout: 15_000 });
      await expect(details.getByTestId('library-media-viewer-description')).toBeVisible({ timeout: 15_000 });
      await expect(details.getByTestId('library-media-viewer-tags')).toBeVisible({ timeout: 15_000 });
      await expect(details.getByTestId('library-media-viewer-transcript')).toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('library-media-viewer-open-analysis')).toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('browse-preview')).toHaveCount(0);
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test('a folder filter with All media keeps photos from that folder visible', async () => {
    const workdir = makeEmptyWorkdir('library-folder-photo');
    const fixture = await seedFolderPhoto(workdir);
    const session = await launch(workdir);
    try {
      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-collection').click();

      const allMedia = session.page.getByTestId('library-media-all');
      await expect(allMedia).toBeVisible({ timeout: 15_000 });
      await allMedia.click();
      await expect(allMedia).toHaveAttribute('aria-pressed', 'true');

      const folderInput = session.page.getByTestId('library-filter-folder').getByRole('combobox');
      await folderInput.click();
      await folderInput.pressSequentially(fixture.folderLabel);
      await session.page.getByRole('option', { name: `${fixture.folderLabel} (1)` }).click();
      await expect(session.page.getByTestId(`library-chip-folder:${fixture.folderId}`)).toBeVisible();

      const photo = session.page.locator(
        `[data-testid="library-tile"][data-media="photo"][data-fingerprint="${fixture.fingerprint}"]`,
      );
      await expect(photo).toBeVisible({ timeout: 20_000 });
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test('the hide-unavailable toggle removes a disconnected-drive tile and brings it back when switched off', async () => {
    const workdir = makeEmptyWorkdir('library-hide-unavailable');
    const fixture = await seedUnavailableVideo(workdir);
    const session = await launch(workdir);
    try {
      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-collection').click();

      const available = session.page.locator(`[data-testid="library-tile"][data-fingerprint="${fixture.availableFingerprint}"]`);
      const unavailable = session.page.locator(`[data-testid="library-tile"][data-fingerprint="${fixture.unavailableFingerprint}"]`);
      await expect(available).toBeVisible({ timeout: 20_000 });
      await expect(unavailable).toBeVisible({ timeout: 20_000 });

      const toggle = session.page.getByTestId('library-hide-unavailable');
      await expect(toggle).toBeVisible({ timeout: 15_000 });
      await toggle.click();

      await expect(unavailable).toHaveCount(0, { timeout: 20_000 });
      await expect(available).toBeVisible();

      await toggle.click();
      await expect(unavailable).toBeVisible({ timeout: 20_000 });
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test('a video tile opens the same fullscreen viewer as a photo and the arrows walk the mixed collection', async () => {
    const workdir = makeEmptyWorkdir('library-media-viewer');
    const fixture = await seedFolderPhoto(workdir);
    const session = await launch(workdir);
    try {
      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-collection').click();

      const allMedia = session.page.getByTestId('library-media-all');
      await expect(allMedia).toBeVisible({ timeout: 15_000 });
      await allMedia.click();

      const videoTile = session.page.locator(
        `[data-testid="library-tile"][data-media="video"][data-fingerprint="${fixture.videoFingerprint}"]`,
      );
      await expect(videoTile).toBeVisible({ timeout: 20_000 });
      await videoTile.click();

      const viewer = session.page.getByTestId('library-media-viewer');
      await expect(viewer).toBeVisible({ timeout: 15_000 });
      await expect(viewer).toHaveAttribute('data-fingerprint', fixture.videoFingerprint);
      await expect(viewer).toHaveAttribute('data-media', 'video');
      await expect(session.page.getByTestId('library-media-viewer-player')).toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('library-media-viewer-details')).toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('library-media-viewer-description')).toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('library-media-viewer-open-analysis')).toBeVisible({ timeout: 15_000 });

      await session.page.getByTestId('library-media-viewer-next').click();
      await expect(viewer).toHaveAttribute('data-fingerprint', fixture.fingerprint, { timeout: 15_000 });
      await expect(viewer).toHaveAttribute('data-media', 'photo');
      await expect(session.page.getByTestId('library-media-viewer-image')).toBeVisible({ timeout: 15_000 });

      await session.page.getByTestId('library-media-viewer-previous').click();
      await expect(viewer).toHaveAttribute('data-fingerprint', fixture.videoFingerprint, { timeout: 15_000 });
      await expect(session.page.getByTestId('library-media-viewer-player')).toBeVisible({ timeout: 15_000 });

      await session.page.getByTestId('library-media-viewer-close').click();
      await expect(viewer).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
