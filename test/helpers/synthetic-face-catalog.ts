import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '@adapters/db/index.js';
import { NodeFileSystemPort } from '@adapters/fs/index.js';
import type { CatalogFile, CatalogFolder, FaceObservation, Person } from '@core/domain/index.js';
import type { PhotoFolderRecord, PhotoRecord, PhotoSightingRecord, RecordPhotoAnalysisInput } from '@core/server/index.js';

export interface SyntheticFaceCatalogShape {
  people: number;
  videos: number;
  photos: number;
  videoObservationsPerFile: number;
  photoObservationsPerFile: number;
  analysedPhotoEvery: number;
}

export interface SyntheticFaceCatalog {
  home: string;
  mediaRoot: string;
  globalCatalog: SqlJsGlobalCatalogStore;
  photos: SqlJsPhotosStore;
  fs: NodeFileSystemPort;
  busiestPersonId: string;
  observations: number;
  seedMs: number;
}

const VIDEO_FOLDER_ID = '33333333-3333-4333-8333-333333333333';
const PHOTO_FOLDER_ID = 'path-synthetic-photos';
const PHOTO_CONFIG_ID = 'cfg_000000000001';

const embedding = (seed: number): number[] =>
  Array.from({ length: 128 }, (_value, index) => ((seed * 31 + index * 7) % 97) / 97);

const personIdOf = (index: number): string => `person-${String(index).padStart(5, '0')}`;

const videoFingerprintOf = (index: number): string => `vid_${String(index).padStart(10, '0')}`;

const photoFingerprintOf = (index: number): string => `ph_${String(index).padStart(14, '0')}`;

const capturedAtOf = (index: number): string =>
  `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`;

const videoFolderOf = (currentPath: string): CatalogFolder => ({
  folderId: VIDEO_FOLDER_ID,
  currentPath,
  displayName: 'synthetic',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
});

const videoFileOf = (index: number): CatalogFile => ({
  fingerprint: videoFingerprintOf(index),
  folderId: VIDEO_FOLDER_ID,
  fileName: `clip-${String(index)}.mp4`,
  size: 1024,
  durationS: 30,
  width: 1920,
  height: 1080,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-01-02T00:00:00.000Z',
  analyzer: 'openai',
  model: 'gpt-4.1-mini',
  missingAt: null,
  capturedAt: capturedAtOf(index),
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
});

const photoFolderOf = (currentPath: string): PhotoFolderRecord => ({
  folderId: PHOTO_FOLDER_ID,
  currentPath,
  displayName: 'synthetic-photos',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  defaultConfigId: null,
});

const photoOf = (index: number, root: string): PhotoRecord => ({
  fingerprint: photoFingerprintOf(index),
  folderId: PHOTO_FOLDER_ID,
  fileName: `photo-${String(index)}.jpg`,
  currentPath: `${root}/photo-${String(index)}.jpg`,
  ext: 'jpg',
  size: 2048,
  width: 4000,
  height: 3000,
  orientation: 1,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  iso: null,
  fNumber: null,
  exposureTime: null,
  exifRating: null,
  capturedAt: capturedAtOf(index),
  capturedAtSource: 'exif_offset',
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
  discoveredAt: '2026-01-01T00:00:00.000Z',
  exifReadAt: '2026-01-01T00:00:00.000Z',
  proxyState: 'done',
  proxyWidth: 1600,
  proxyHeight: 1200,
  thumbState: 'done',
  missingAt: null,
  selectedConfigId: null,
});

const sightingOf = (photo: PhotoRecord): PhotoSightingRecord => ({
  fingerprint: photo.fingerprint,
  currentPath: photo.currentPath,
  folderId: photo.folderId,
  size: photo.size,
  mtimeMs: 1000,
  lastSeenAt: '2026-01-01T00:00:00.000Z',
});

const analysisOf = (photo: PhotoRecord): RecordPhotoAnalysisInput => ({
  fingerprint: photo.fingerprint,
  configId: PHOTO_CONFIG_ID,
  description: `Synthetic photo ${photo.fileName}`,
  scene: 'indoor',
  quality: 'good',
  language: 'en',
  analyzer: 'harness',
  model: null,
  batchSize: 1,
  usageJson: null,
  tags: ['synthetic'],
  createdAt: '2026-01-01T00:00:00.000Z',
});

const personOf = (index: number): Person => ({
  personId: personIdOf(index),
  displayName: index % 10 === 0 ? `Person ${String(index)}` : null,
  kind: 'face',
  createdAt: '2026-01-01T00:00:00.000Z',
  centroid: embedding(index),
  exemplarCount: 1,
});

const observationOf = (input: {
  fingerprint: string;
  media: FaceObservation['media'];
  detection: number;
  personIndex: number;
}): FaceObservation => ({
  obsId: `${input.fingerprint}:face:1:${String(input.detection)}`,
  fingerprint: input.fingerprint,
  kind: 'face',
  frameTsS: input.media === 'photo' ? null : 1,
  bbox: { x: 0, y: 0, width: 100, height: 100 },
  embedding: embedding(input.detection + input.personIndex),
  quality: 0.5 + ((input.personIndex % 40) / 100),
  personId: personIdOf(input.personIndex),
  cropPath: null,
  media: input.media,
});

export const seedSyntheticFaceCatalog = async (
  home: string,
  shape: SyntheticFaceCatalogShape,
): Promise<SyntheticFaceCatalog> => {
  const startedAt = Date.now();
  const mediaRoot = path.join(home, 'media');
  await mkdir(mediaRoot, { recursive: true });
  const globalCatalog = new SqlJsGlobalCatalogStore({ homeDirectory: home });
  const photos = new SqlJsPhotosStore({ homeDirectory: home });

  const written = await globalCatalog.withBatch(async () => {
    const folder = await globalCatalog.upsertFolder(videoFolderOf(mediaRoot));
    if (!folder.ok) return folder;
    for (let index = 0; index < shape.people; index += 1) {
      const person = await globalCatalog.upsertPerson(personOf(index));
      if (!person.ok) return person;
    }
    for (let index = 0; index < shape.videos; index += 1) {
      const file = await globalCatalog.upsertFile(videoFileOf(index));
      if (!file.ok) return file;
    }
    return { ok: true as const, value: undefined };
  });
  if (!written.ok) throw new Error(written.error.message);

  const photosWritten = await photos.withBatch(async () => {
    const folder = await photos.upsertFolder(photoFolderOf(mediaRoot));
    if (!folder.ok) return folder;
    const analysisConfig = await photos.upsertAnalysisConfig({
      configId: PHOTO_CONFIG_ID,
      descriptorJson: '{}',
      label: 'synthetic',
      now: '2026-01-01T00:00:00.000Z',
    });
    if (!analysisConfig.ok) return analysisConfig;
    for (let index = 0; index < shape.photos; index += 1) {
      const photo = photoOf(index, mediaRoot);
      const upserted = await photos.upsertPhoto(photo);
      if (!upserted.ok) return upserted;
      const sighting = await photos.upsertSighting(sightingOf(photo));
      if (!sighting.ok) return sighting;
      if (index % shape.analysedPhotoEvery === 0) {
        const analysed = await photos.recordPhotoAnalysis(analysisOf(photo));
        if (!analysed.ok) return analysed;
      }
    }
    return { ok: true as const, value: undefined };
  });
  if (!photosWritten.ok) throw new Error(photosWritten.error.message);

  let observations = 0;
  let personIndex = 0;
  const nextPersonIndex = (): number => {
    const current = personIndex;
    personIndex = (personIndex + 1) % shape.people;
    return current;
  };
  const observationsWritten = await globalCatalog.withBatch(async () => {
    for (let index = 0; index < shape.videos; index += 1) {
      for (let detection = 1; detection <= shape.videoObservationsPerFile; detection += 1) {
        const upserted = await globalCatalog.upsertFaceObservation(observationOf({
          fingerprint: videoFingerprintOf(index),
          media: 'video',
          detection,
          personIndex: detection === 1 ? 0 : nextPersonIndex(),
        }));
        if (!upserted.ok) return upserted;
        observations += 1;
      }
    }
    for (let index = 0; index < shape.photos; index += 1) {
      for (let detection = 1; detection <= shape.photoObservationsPerFile; detection += 1) {
        const upserted = await globalCatalog.upsertFaceObservation(observationOf({
          fingerprint: photoFingerprintOf(index),
          media: 'photo',
          detection,
          personIndex: index % 7 === 0 && detection === 1 ? 0 : nextPersonIndex(),
        }));
        if (!upserted.ok) return upserted;
        observations += 1;
      }
    }
    return { ok: true as const, value: undefined };
  });
  if (!observationsWritten.ok) throw new Error(observationsWritten.error.message);

  const flushedCatalog = await globalCatalog.flush();
  if (!flushedCatalog.ok) throw new Error(flushedCatalog.error.message);
  const flushedPhotos = await photos.flush();
  if (!flushedPhotos.ok) throw new Error(flushedPhotos.error.message);

  return {
    home,
    mediaRoot,
    globalCatalog,
    photos,
    fs: new NodeFileSystemPort(),
    busiestPersonId: personIdOf(0),
    observations,
    seedMs: Date.now() - startedAt,
  };
};
