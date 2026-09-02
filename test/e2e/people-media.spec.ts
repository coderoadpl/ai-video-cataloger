import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '../../adapters/db/index.js';
import { fileArtifactPath } from '../../adapters/whisper/index.js';
import { FILE_ARTIFACTS, derivedFolderId, type AppError, type Result } from '../../core/domain/index.js';
import { REAL_JPEG_RED_LARGE } from '../fixtures/real-jpegs.js';
import { ELECTRON_MAIN, isolatedHome, makeEmptyWorkdir, RENDERER_HTML, REPO_ROOT, stubOpenDialog } from './helpers.js';

interface Session {
  app: ElectronApplication;
  page: Page;
}

const TIMESTAMP = '2026-08-16T12:00:00.000Z';
const VIDEO_FINGERPRINT = 'video-shared-person';
const PHOTO_FINGERPRINT = 'ph_1000000000000001';
const SHARED_PERSON_ID = 'person-shared';
const VIDEO_ONLY_PERSON_ID = 'person-video-only';
const VIDEO_ONLY_VIDEO_FINGERPRINT = 'video-only-person';

const expectResult = <T>(result: Result<T, AppError>): asserts result is { ok: true; value: T } => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
};

const embedding = Array.from({ length: 128 }, (_value, index) => (index === 0 ? 1 : 0));

const observation = (input: {
  obsId: string;
  fingerprint: string;
  personId: string;
  media: 'video' | 'photo';
}) => ({
  obsId: input.obsId,
  fingerprint: input.fingerprint,
  kind: 'face' as const,
  frameTsS: input.media === 'video' ? 1 : null,
  bbox: { x: 0, y: 0, width: 80, height: 80 },
  embedding,
  quality: 0.9,
  personId: input.personId,
  cropPath: null,
  media: input.media,
});

const seedCatalog = async (workdir: string): Promise<{ workspacePath: string }> => {
  const homeDirectory = isolatedHome(workdir);
  const folderPath = join(workdir, 'people-media');
  const folderId = '90909090-9090-4090-8090-909090909090';
  const photoFolderId = derivedFolderId(folderPath);
  const workspacePath = join(workdir, 'workspace');
  mkdirSync(folderPath, { recursive: true });
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(join(folderPath, 'shared.jpg'), REAL_JPEG_RED_LARGE);
  writeFileSync(join(folderPath, 'shared.mp4'), Buffer.from([0]));
  writeFileSync(join(folderPath, 'solo.mp4'), Buffer.from([0]));

  for (const artifact of Object.values(FILE_ARTIFACTS)) {
    const artifactPath = fileArtifactPath(homeDirectory, artifact);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, Buffer.from([0]));
  }

  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory });
  const photos = new SqlJsPhotosStore({ homeDirectory });
  try {
    expectResult(await globalCatalog.upsertFolder({
      folderId,
      currentPath: folderPath,
      displayName: 'People Media',
      firstSeenAt: TIMESTAMP,
      lastSeenAt: TIMESTAMP,
    }));
    for (const [fingerprint, fileName] of [
      [VIDEO_FINGERPRINT, 'shared.mp4'],
      [VIDEO_ONLY_VIDEO_FINGERPRINT, 'solo.mp4'],
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
        model: 'claude-code',
        missingAt: null,
        capturedAt: '2026-08-15T12:00:00.000Z',
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
        description: `A clip named ${fileName}.`,
        transcript: null,
        language: 'en',
        tags: [],
      }));
    }

    expectResult(await photos.upsertFolder({
      folderId: photoFolderId,
      currentPath: folderPath,
      displayName: 'People Media',
      firstSeenAt: TIMESTAMP,
      lastSeenAt: TIMESTAMP,
      defaultConfigId: null,
    }));
    expectResult(await photos.upsertPhoto({
      fingerprint: PHOTO_FINGERPRINT,
      folderId: photoFolderId,
      fileName: 'shared.jpg',
      currentPath: join(folderPath, 'shared.jpg'),
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
      capturedAt: '2026-08-17T12:00:00.000Z',
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
      thumbState: 'pending',
      missingAt: null,
      selectedConfigId: null,
    }));
    expectResult(await photos.upsertAnalysisConfig({
      configId: 'cfg_909090909090',
      descriptorJson: JSON.stringify({ family: 'harness', providerId: 'claude-code', output_language: 'en' }),
      label: 'harness · claude-code · en',
      now: TIMESTAMP,
    }));
    expectResult(await photos.recordPhotoAnalysis({
      fingerprint: PHOTO_FINGERPRINT,
      configId: 'cfg_909090909090',
      description: 'A photo the shared person appears in.',
      scene: 'people',
      quality: 'good',
      language: 'en',
      analyzer: 'harness',
      model: 'claude-code',
      batchSize: 1,
      usageJson: null,
      tags: [],
      createdAt: TIMESTAMP,
    }));

    for (const [personId, displayName] of [
      [SHARED_PERSON_ID, 'Shared Person'],
      [VIDEO_ONLY_PERSON_ID, 'Video Person'],
    ] as const) {
      expectResult(await globalCatalog.upsertPerson({
        personId,
        displayName,
        kind: 'face',
        createdAt: TIMESTAMP,
        centroid: embedding,
        exemplarCount: 1,
      }));
    }
    expectResult(await globalCatalog.upsertFaceObservation(observation({
      obsId: `${VIDEO_FINGERPRINT}:face:1:1`,
      fingerprint: VIDEO_FINGERPRINT,
      personId: SHARED_PERSON_ID,
      media: 'video',
    })));
    expectResult(await globalCatalog.upsertFaceObservation(observation({
      obsId: `${PHOTO_FINGERPRINT}:face:1:1`,
      fingerprint: PHOTO_FINGERPRINT,
      personId: SHARED_PERSON_ID,
      media: 'photo',
    })));
    expectResult(await globalCatalog.upsertFaceObservation(observation({
      obsId: `${VIDEO_ONLY_VIDEO_FINGERPRINT}:face:1:1`,
      fingerprint: VIDEO_ONLY_VIDEO_FINGERPRINT,
      personId: VIDEO_ONLY_PERSON_ID,
      media: 'video',
    })));
  } finally {
    expectResult(await photos.dispose());
    expectResult(await globalCatalog.dispose());
  }

  return { workspacePath };
};

async function launch(workdir: string): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'avc-people-media-userdata-'));
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

const openWorkspaceFolder = async (session: Session, workspacePath: string): Promise<void> => {
  await session.page.getByTestId('mode-analysis').click();
  await stubOpenDialog(session.app, workspacePath);
  const openFolderButton = session.page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
  await expect(openFolderButton).toBeVisible({ timeout: 15_000 });
  await openFolderButton.click();
  await expect(session.page.getByText(workspacePath)).toBeVisible({ timeout: 30_000 });
};

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

const openPeopleSurface = async (page: Page): Promise<void> => {
  await page.getByTestId('mode-library').click();
  await page.getByTestId('subnav-people').click();
  await expect(page.getByTestId('people-grid')).toBeVisible({ timeout: 30_000 });
};

test.describe('People across media', () => {
  test('media chips narrow the person list and a person card lists photos and videos', async () => {
    const workdir = makeEmptyWorkdir('people-media-chips');
    const { workspacePath } = await seedCatalog(workdir);
    const session = await launch(workdir);
    try {
      await openWorkspaceFolder(session, workspacePath);
      await enableFaces(session.page);
      await openPeopleSurface(session.page);

      await expect(session.page.getByTestId('people-card')).toHaveCount(2, { timeout: 30_000 });
      await expect(session.page.getByTestId('people-media-all')).toContainText('(2)');
      await expect(session.page.getByTestId('people-media-photo')).toContainText('(1)');
      await expect(session.page.getByTestId('people-media-video')).toContainText('(2)');

      const sharedCard = session.page.locator('[data-testid="people-card"][data-person-id="person-shared"]');
      await sharedCard.getByTestId('people-card-body').click();

      const personMedia = session.page.getByTestId('person-media-panel');
      await expect(personMedia).toBeVisible({ timeout: 30_000 });
      await expect(personMedia.locator('[data-testid="library-tile"][data-media="video"]')).toHaveCount(1);
      const photoTile = personMedia.locator('[data-testid="library-tile"][data-media="photo"]');
      await expect(photoTile).toHaveCount(1);

      await photoTile.click();
      const viewer = session.page.getByTestId('library-media-viewer');
      await expect(viewer).toBeVisible({ timeout: 15_000 });
      await expect(viewer).toHaveAttribute('data-media', 'photo');
      await expect(viewer.getByTestId('library-media-viewer-people')).toContainText('Shared Person', { timeout: 15_000 });
      await session.page.getByTestId('library-media-viewer-close').click();
      await expect(viewer).toBeHidden({ timeout: 15_000 });
      await session.page.getByTestId('person-media-close').click();

      await session.page.getByTestId('people-media-photo').click();
      await expect(session.page.getByTestId('people-card')).toHaveCount(1, { timeout: 15_000 });
      await expect(session.page.getByTestId('people-card')).toHaveAttribute('data-person-id', 'person-shared');
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test('filtering the collection by a person keeps that person\'s photos', async () => {
    const workdir = makeEmptyWorkdir('people-media-collection');
    const { workspacePath } = await seedCatalog(workdir);
    const session = await launch(workdir);
    try {
      await openWorkspaceFolder(session, workspacePath);
      await enableFaces(session.page);
      await openPeopleSurface(session.page);

      const sharedCard = session.page.locator('[data-testid="people-card"][data-person-id="person-shared"]');
      await sharedCard.getByRole('button', { name: /more actions|więcej działań/i }).click();
      await session.page.getByTestId('people-search-library').click();

      const grid = session.page.getByTestId('library-grid');
      await expect(grid).toBeVisible({ timeout: 30_000 });
      await expect(grid.locator('[data-testid="library-tile"]')).toHaveCount(2, { timeout: 30_000 });
      await expect(grid.locator('[data-testid="library-tile"][data-media="photo"]')).toHaveCount(1);
      await expect(grid.locator('[data-testid="library-tile"][data-media="video"]')).toHaveCount(1);
      await expect(session.page.getByTestId('library-video-only-filter-notice')).toHaveCount(0);
      await expect(session.page.getByTestId('library-media-photo')).toContainText('(1)');
    } finally {
      await session.app.close().catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
