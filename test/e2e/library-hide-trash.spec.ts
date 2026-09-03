import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import initSqlJs from 'sql.js';
import { z } from 'zod';

import { SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '../../adapters/db/index.js';
import { fileArtifactPath } from '../../adapters/whisper/index.js';
import { derivedFolderId, FILE_ARTIFACTS, type AppError, type Result } from '../../core/domain/index.js';
import { REAL_JPEG_RED_LARGE } from '../fixtures/real-jpegs.js';
import { ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, RENDERER_HTML, REPO_ROOT, stubOpenDialog } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

interface SeededLibrary {
  folderPath: string;
  photoPath: string;
  videoPath: string;
  videoSharedFingerprint: string;
  videoSoloFingerprint: string;
  photoFingerprint: string;
  personId: string;
  videoSidecarFrame: string;
  videoFaceCrop: string;
  photoThumb: string;
}

const TIMESTAMP = '2026-08-16T12:00:00.000Z';
const multiSelectModifier = process.platform === 'darwin' ? 'Meta' as const : 'Control' as const;
const sqlValueSchema = z.union([z.string(), z.number(), z.null()]);
const sqlCountSchema = z.number().int().nonnegative();

const expectResult = <T>(result: Result<T, AppError>): asserts result is { ok: true; value: T } => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
};

const embedding = Array.from({ length: 128 }, (_value, index) => (index === 0 ? 1 : 0));

const fileCount = async (homeDirectory: string, table: string, fingerprint: string): Promise<number> => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(join(homeDirectory, '.ai-video-cataloger', 'catalog.db')));
  try {
    const result = db.exec(`SELECT COUNT(*) FROM ${table} WHERE fingerprint = ?`, [fingerprint]);
    return sqlCountSchema.parse(result[0]?.values[0]?.[0]);
  } finally {
    db.close();
  }
};

const hiddenAt = async (homeDirectory: string, fingerprint: string): Promise<string | number | null> => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(join(homeDirectory, '.ai-video-cataloger', 'catalog.db')));
  try {
    const result = db.exec('SELECT hidden_at FROM files WHERE fingerprint = ?', [fingerprint]);
    return sqlValueSchema.parse(result[0]?.values[0]?.[0] ?? null);
  } finally {
    db.close();
  }
};

const writeArtifact = (targetPath: string): void => {
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, Buffer.from([1, 2, 3]));
};

const seedCatalog = async (workdir: string): Promise<SeededLibrary> => {
  const homeDirectory = isolatedHome(workdir);
  const folderPath = join(workdir, 'library-fixture');
  const folderId = '88888888-8888-4888-8888-888888888888';
  const photoFolderId = derivedFolderId(folderPath);
  const videoSharedFingerprint = 'video-w88b-shared';
  const videoSoloFingerprint = 'video-w88b-solo';
  const photoFingerprint = 'ph_8800000000000001';
  const personId = 'person-w88b';
  const otherPersonId = 'person-w88b-other';
  const videoSharedName = 'shared-person.mp4';
  const videoSoloName = 'solo-person.mp4';
  const photoName = 'person-photo.jpg';
  const videoPath = join(folderPath, videoSoloName);
  const photoPath = join(folderPath, photoName);
  mkdirSync(folderPath, { recursive: true });
  writeFileSync(join(folderPath, videoSharedName), Buffer.from([1]));
  writeFileSync(videoPath, Buffer.from([2]));
  writeFileSync(photoPath, REAL_JPEG_RED_LARGE);

  for (const artifact of Object.values(FILE_ARTIFACTS)) {
    const targetPath = fileArtifactPath(homeDirectory, artifact);
    const realPath = fileArtifactPath(userInfo().homedir, artifact);
    mkdirSync(dirname(targetPath), { recursive: true });
    if (existsSync(realPath)) {
      copyFileSync(realPath, targetPath);
    } else {
      writeArtifact(targetPath);
    }
  }

  const videoSidecarFrame = join(folderPath, '.ai-video-cataloger', 'artifacts', 'frames', videoSoloFingerprint, 'frame.jpg');
  const videoLooseFrame = join(folderPath, 'frames', 'solo-person', 'frame-001.jpg');
  const videoThumb = join(folderPath, '.ai-video-cataloger', 'thumbnails', 'solo-person.jpg');
  const photoThumb = join(homeDirectory, '.ai-video-cataloger', 'photo-artifacts', 'thumbs', `${photoFingerprint}.jpg`);
  const cropPath = join(homeDirectory, '.ai-video-cataloger', 'faces', 'obs', videoSoloFingerprint, 'crop.jpg');
  for (const artifactPath of [videoSidecarFrame, videoLooseFrame, videoThumb, photoThumb, cropPath]) writeArtifact(artifactPath);

  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory });
  const photos = new SqlJsPhotosStore({ homeDirectory });
  try {
    expectResult(await globalCatalog.upsertFolder({
      folderId,
      currentPath: folderPath,
      displayName: 'Library Fixture',
      firstSeenAt: TIMESTAMP,
      lastSeenAt: TIMESTAMP,
    }));
    for (const [fingerprint, fileName, capturedAt] of [
      [videoSharedFingerprint, videoSharedName, '2026-08-18T12:00:00.000Z'],
      [videoSoloFingerprint, videoSoloName, '2026-08-17T12:00:00.000Z'],
    ] as const) {
      expectResult(await globalCatalog.upsertFile({
        fingerprint,
        folderId,
        fileName,
        size: 1,
        durationS: null,
        width: null,
        height: null,
        gpsLat: null,
        gpsLon: null,
        processedAt: TIMESTAMP,
        analyzer: 'harness',
        model: 'catalog-fixture',
        missingAt: null,
        hiddenAt: null,
        capturedAt,
        capturedAtSource: 'container',
        gpsSource: null,
        gpsAccuracyM: null,
        gpsIntervalKind: null,
        gpsResolvedAt: null,
        place: null,
      }));
      expectResult(await globalCatalog.upsertAnalysis({
        fingerprint,
        finalName: null,
        description: `A fixture clip named ${fileName}.`,
        transcript: null,
        language: 'en',
        tags: [],
      }));
    }

    expectResult(await photos.upsertFolder({
      folderId: photoFolderId,
      currentPath: folderPath,
      displayName: 'Library Fixture',
      firstSeenAt: TIMESTAMP,
      lastSeenAt: TIMESTAMP,
      defaultConfigId: null,
    }));
    expectResult(await photos.upsertPhoto({
      fingerprint: photoFingerprint,
      folderId: photoFolderId,
      fileName: photoName,
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
      capturedAt: '2026-08-16T12:00:00.000Z',
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
      discoveredAt: TIMESTAMP,
      exifReadAt: TIMESTAMP,
      proxyState: 'pending',
      proxyWidth: null,
      proxyHeight: null,
      thumbState: 'done',
      missingAt: null,
      selectedConfigId: null,
    }));
    expectResult(await photos.upsertAnalysisConfig({
      configId: 'cfg_w88b_photo',
      descriptorJson: JSON.stringify({ family: 'harness', providerId: 'catalog-fixture', output_language: 'en' }),
      label: 'harness',
      now: TIMESTAMP,
    }));
    expectResult(await photos.recordPhotoAnalysis({
      fingerprint: photoFingerprint,
      configId: 'cfg_w88b_photo',
      description: 'A fixture photo for hidden-filter coverage.',
      scene: 'people',
      quality: 'good',
      language: 'en',
      analyzer: 'harness',
      model: 'catalog-fixture',
      batchSize: 1,
      usageJson: null,
      tags: [],
      createdAt: TIMESTAMP,
    }));

    for (const [seedPersonId, displayName] of [
      [personId, 'Fixture Person'],
      [otherPersonId, 'Shared Fixture Person'],
    ] as const) {
      expectResult(await globalCatalog.upsertPerson({
        personId: seedPersonId,
        displayName,
        kind: 'face',
        createdAt: TIMESTAMP,
        centroid: embedding,
        exemplarCount: 1,
      }));
    }
    for (const [obsId, fingerprint, seedPersonId, crop] of [
      ['obs-w88b-shared-target', videoSharedFingerprint, personId, null],
      ['obs-w88b-solo-target', videoSoloFingerprint, personId, cropPath],
      ['obs-w88b-shared-other', videoSharedFingerprint, otherPersonId, null],
      ['obs-w88b-photo-target', photoFingerprint, personId, null],
    ] as const) {
      expectResult(await globalCatalog.upsertFaceObservation({
        obsId,
        fingerprint,
        kind: 'face',
        frameTsS: fingerprint === photoFingerprint ? null : 1,
        bbox: { x: 0, y: 0, width: 80, height: 80 },
        embedding,
        quality: 0.9,
        personId: seedPersonId,
        cropPath: crop,
        media: fingerprint === photoFingerprint ? 'photo' : 'video',
      }));
    }
  } finally {
    expectResult(await photos.dispose());
    expectResult(await globalCatalog.dispose());
  }

  return {
    folderPath,
    photoPath,
    videoPath,
    videoSharedFingerprint,
    videoSoloFingerprint,
    photoFingerprint,
    personId,
    videoSidecarFrame,
    videoFaceCrop: cropPath,
    photoThumb,
  };
};

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-library-hide-trash-userdata-'));
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

const enableFaces = async (page: Page): Promise<void> => {
  await page.getByTestId('open-settings-button').click();
  const modal = page.getByTestId('settings-modal');
  await expect(modal).toBeVisible({ timeout: 15_000 });
  const facesSwitch = page.getByTestId('faces-enabled-switch');
  await expect(facesSwitch).toBeVisible({ timeout: 15_000 });
  if (!(await facesSwitch.locator('input[type="checkbox"]').isChecked())) {
    await facesSwitch.click();
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('saved-snackbar')).toBeVisible({ timeout: 15_000 });
  } else {
    await page.getByTestId('settings-cancel').click();
  }
  await expect(modal).toBeHidden({ timeout: 15_000 });
};

const openCollection = async (page: Page): Promise<void> => {
  await page.getByTestId('mode-library').click();
  await page.getByTestId('subnav-collection').click();
  await expect(page.getByTestId('library-grid')).toBeVisible({ timeout: 30_000 });
};

const restoreAllHidden = async (page: Page, fingerprint: string): Promise<void> => {
  await page.getByTestId('mode-library').click();
  await page.getByTestId('subnav-collection').click();
  await expect(page.getByTestId('library-hidden-filter')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('library-hidden-filter').click();
  const hiddenTile = page.locator(`[data-testid="library-tile"][data-fingerprint="${fingerprint}"]`);
  await expect(hiddenTile).toBeVisible({ timeout: 20_000 });
  await hiddenTile.click({ modifiers: [multiSelectModifier] });
  await page.getByTestId('library-select-all').click();
  await page.getByTestId('library-unhide-selected').click();
  await expect(hiddenTile).toHaveCount(0, { timeout: 20_000 });
  await page.getByTestId('library-hidden-filter').click();
};

const installTrashRecorder = async (app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ shell }) => {
    Reflect.set(globalThis, 'avcTrashedPaths', []);
    const originalTrashItem = shell.trashItem.bind(shell);
    shell.trashItem = async (targetPath: string): Promise<void> => {
      Reflect.get(globalThis, 'avcTrashedPaths').push(targetPath);
      await originalTrashItem(targetPath);
    };
  });
};

const trashedPaths = async (app: ElectronApplication): Promise<readonly string[]> =>
  app.evaluate(() => Reflect.get(globalThis, 'avcTrashedPaths') ?? []);

test.describe('Library hide and trash', () => {
  test('Kolekcja and Osoby hide, restore, and move selected media to Trash', async () => {
    const workdir = makeEmptyWorkdir('library-hide-trash');
    const fixture = await seedCatalog(workdir);
    const session = await launch(workdir);
    const homeDirectory = isolatedHome(workdir);
    try {
      await openCollection(session.page);
      await expect(session.page.getByTestId('library-tile')).toHaveCount(3, { timeout: 30_000 });

      const sharedTile = session.page.locator(`[data-testid="library-tile"][data-fingerprint="${fixture.videoSharedFingerprint}"]`);
      const soloTile = session.page.locator(`[data-testid="library-tile"][data-fingerprint="${fixture.videoSoloFingerprint}"]`);
      await sharedTile.click({ modifiers: [multiSelectModifier] });
      await soloTile.click({ modifiers: [multiSelectModifier] });
      await expect(session.page.getByTestId('library-selection-count')).toContainText('2', { timeout: 15_000 });
      await session.page.getByTestId('library-hide-selected').click();
      await expect(sharedTile).toHaveCount(0, { timeout: 20_000 });
      await expect(soloTile).toHaveCount(0, { timeout: 20_000 });
      await expect.poll(() => hiddenAt(homeDirectory, fixture.videoSharedFingerprint)).not.toBeNull();
      await expect.poll(() => hiddenAt(homeDirectory, fixture.videoSoloFingerprint)).not.toBeNull();

      await restoreAllHidden(session.page, fixture.videoSharedFingerprint);
      await expect.poll(() => hiddenAt(homeDirectory, fixture.videoSharedFingerprint)).toBeNull();
      await expect.poll(() => hiddenAt(homeDirectory, fixture.videoSoloFingerprint)).toBeNull();

      await stubOpenDialog(session.app, fixture.folderPath);
      await session.page.getByTestId('mode-analysis').click();
      const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
      await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
      await openFolderButton.click();
      await expect(session.page.getByText(fixture.folderPath)).toBeVisible({ timeout: 20_000 });

      await enableFaces(session.page);
      await session.page.getByTestId('mode-library').click();
      await session.page.getByTestId('subnav-people').click();
      const personCard = session.page.locator(`[data-testid="people-card"][data-person-id="${fixture.personId}"]`);
      await expect(personCard).toBeVisible({ timeout: 30_000 });
      await personCard.getByRole('button', { name: /more actions|więcej działań/i }).click();
      await session.page.getByTestId('people-hide-files').click();
      await expect(session.page.getByTestId('people-library-action-summary')).toContainText(/also contains other recognized people|zawiera także inne rozpoznane osoby/i);
      await expect(session.page.getByTestId('people-library-skip-shared').locator('input[type="checkbox"]')).not.toBeChecked();
      await session.page.getByTestId('people-hide-files-confirm').click();
      await expect(personCard).toHaveCount(0, { timeout: 20_000 });

      await restoreAllHidden(session.page, fixture.videoSharedFingerprint);
      await session.page.getByTestId('subnav-people').click();
      await expect(personCard).toBeVisible({ timeout: 30_000 });
      await personCard.getByRole('button', { name: /more actions|więcej działań/i }).click();
      await session.page.getByTestId('people-trash-files').click();
      await expect(session.page.getByTestId('library-trash-person-summary')).toContainText(/2 files, including 0|2 pliki, z czego 0/, { timeout: 20_000 });
      await expect(session.page.getByTestId('people-library-skip-shared').locator('input[type="checkbox"]')).toBeChecked();
      await session.page.keyboard.press('Escape');

      await openCollection(session.page);
      await installTrashRecorder(session.app);
      expect(existsSync(fixture.videoPath)).toBe(true);
      expect(existsSync(fixture.videoSidecarFrame)).toBe(true);
      expect(existsSync(fixture.videoFaceCrop)).toBe(true);
      expect(existsSync(fixture.photoThumb)).toBe(true);
      await soloTile.click({ modifiers: [multiSelectModifier] });
      await session.page.getByTestId('library-trash-selected').click();
      await expect(session.page.getByTestId('library-trash-dialog')).toBeVisible({ timeout: 15_000 });
      await expect(session.page.getByTestId('library-trash-count')).toContainText('1', { timeout: 15_000 });
      await session.page.getByTestId('library-trash-confirm-check').click();
      await session.page.getByTestId('library-trash-confirm').click();
      await expect(soloTile).toHaveCount(0, { timeout: 30_000 });
      await expect.poll(() => existsSync(fixture.videoPath)).toBe(false);
      await expect.poll(() => existsSync(fixture.videoSidecarFrame)).toBe(false);
      await expect.poll(() => existsSync(fixture.videoFaceCrop)).toBe(false);
      await expect.poll(() => fileCount(homeDirectory, 'files', fixture.videoSoloFingerprint)).toBe(0);
      await expect.poll(() => fileCount(homeDirectory, 'analyses', fixture.videoSoloFingerprint)).toBe(0);
      await expect.poll(() => fileCount(homeDirectory, 'face_observations', fixture.videoSoloFingerprint)).toBe(0);
      await expect.poll(async () => trashedPaths(session.app)).toContain(fixture.videoPath);
      await expect(session.page.locator(`[data-testid="library-tile"][data-fingerprint="${fixture.photoFingerprint}"]`)).toBeVisible();
      await expect.poll(() => existsSync(fixture.photoPath)).toBe(true);
      await expect.poll(() => existsSync(fixture.photoThumb)).toBe(true);
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
