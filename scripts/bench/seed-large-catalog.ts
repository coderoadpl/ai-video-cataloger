import { mkdirSync } from 'node:fs';
import path from 'node:path';

import {
  FACE_EMBEDDING_DIM,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type FaceObservation,
  type Person,
} from '@core/domain/index.js';
import type { PhotoFolderRecord, PhotoRecord, PhotoSightingRecord } from '@core/server/index.js';

import { SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '../../adapters/db/index.js';

export interface SeedSizes {
  photos: number;
  videos: number;
  people: number;
  faceObservations: number;
}

export const DEFAULT_SEED_SIZES: SeedSizes = {
  photos: 40_000,
  videos: 4_000,
  people: 2_000,
  faceObservations: 30_000,
};

const nextRandom = (state: { value: number }): number => {
  state.value = (state.value + 0x6d2b79f5) >>> 0;
  let mixed = state.value;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
};

const WORDS = [
  'wakacje', 'wakacyjny', 'wachlarz', 'wagon', 'walizka', 'waniliowy', 'warsztat', 'wataha',
  'beach', 'birthday', 'boat', 'bridge', 'camp', 'canyon', 'city', 'coast',
  'dinner', 'evening', 'family', 'forest', 'garden', 'harbour', 'hiking', 'holiday',
  'island', 'kitchen', 'lake', 'market', 'morning', 'mountain', 'museum', 'night',
  'party', 'picnic', 'portrait', 'river', 'road', 'sailing', 'skiing', 'snow',
  'street', 'sunset', 'terrace', 'train', 'travel', 'valley', 'village', 'winter',
];

const TAGS = [
  'wakacje', 'wakacje-letnie', 'walizka', 'warsztat', 'beach', 'boat', 'camp', 'city',
  'family', 'forest', 'garden', 'hiking', 'holiday', 'lake', 'market', 'mountain',
  'museum', 'night', 'party', 'picnic', 'portrait', 'river', 'sailing', 'skiing',
  'snow', 'street', 'sunset', 'train', 'travel', 'valley', 'village', 'winter',
];

const PLACES = ['Northport', 'Southbay', 'Eastfield', 'Westhill', 'Lakeside', 'Riverton'];

const sentence = (random: () => number, wordCount: number): string => {
  const words: string[] = [];
  for (let index = 0; index < wordCount; index += 1) {
    words.push(WORDS[Math.floor(random() * WORDS.length)] ?? 'travel');
  }
  return words.join(' ');
};

const pickTags = (random: () => number, count: number): string[] => {
  const picked = new Set<string>();
  while (picked.size < count) picked.add(TAGS[Math.floor(random() * TAGS.length)] ?? 'travel');
  return [...picked];
};

const isoAt = (index: number): string => new Date(Date.UTC(2019, 0, 1) + index * 7 * 60_000).toISOString();

const embedding = (random: () => number): number[] =>
  Array.from({ length: FACE_EMBEDDING_DIM }, () => random() * 2 - 1);

export interface SeedResult {
  home: string;
  sizes: SeedSizes;
  videoRoot: string;
  photoRoot: string;
  elapsedMs: number;
}

export const seedLargeCatalog = async (input: {
  home: string;
  sizes?: Partial<SeedSizes> | undefined;
  seed?: number | undefined;
  onProgress?: ((message: string) => void) | undefined;
}): Promise<SeedResult> => {
  const sizes: SeedSizes = { ...DEFAULT_SEED_SIZES, ...input.sizes };
  const state = { value: input.seed ?? 20_260_102 };
  const random = (): number => nextRandom(state);
  const report = input.onProgress ?? ((): void => undefined);
  const startedAt = Date.now();

  const videoRoot = path.join(input.home, 'media', 'videos');
  const photoRoot = path.join(input.home, 'media', 'photos');
  mkdirSync(videoRoot, { recursive: true });
  mkdirSync(photoRoot, { recursive: true });

  const catalog = new SqlJsGlobalCatalogStore({ homeDirectory: input.home });
  const folder: CatalogFolder = {
    folderId: '11111111-1111-4111-8111-111111111111',
    currentPath: videoRoot,
    displayName: 'videos',
    firstSeenAt: isoAt(0),
    lastSeenAt: isoAt(0),
  };

  const videoFingerprints: string[] = [];
  const seededVideos = await catalog.withBatch(async () => {
    const upsertedFolder = await catalog.upsertFolder(folder);
    if (!upsertedFolder.ok) return upsertedFolder;
    for (let index = 0; index < sizes.videos; index += 1) {
      const fingerprint = `vid_${String(index).padStart(7, '0')}`;
      videoFingerprints.push(fingerprint);
      const hasGps = index % 3 === 0;
      const file: CatalogFile = {
        fingerprint,
        folderId: folder.folderId,
        fileName: `clip-${sentence(random, 1)}-${String(index)}.mp4`,
        size: 20_000_000,
        durationS: 45,
        width: 1920,
        height: 1080,
        gpsLat: hasGps ? 50 + random() : null,
        gpsLon: hasGps ? 19 + random() : null,
        processedAt: isoAt(index),
        analyzer: 'harness',
        model: 'harness-1',
        missingAt: null,
        capturedAt: isoAt(index),
        capturedAtSource: 'container',
        gpsSource: hasGps ? 'camera' : null,
        gpsAccuracyM: null,
        gpsIntervalKind: null,
        gpsResolvedAt: null,
        place: hasGps
          ? {
            name: PLACES[index % PLACES.length] ?? 'Northport',
            region: null,
            country: null,
            countryCode: null,
            distanceM: 100,
            dataset: 'bench',
          }
          : null,
      };
      const upsertedFile = await catalog.upsertFile(file);
      if (!upsertedFile.ok) return upsertedFile;
      const analysis: CatalogAnalysis = {
        fingerprint,
        finalName: `${sentence(random, 3).replaceAll(' ', '-')}.mp4`,
        description: sentence(random, 60),
        transcript: sentence(random, 1_200),
        language: 'pl',
        tags: pickTags(random, 6),
      };
      const upsertedAnalysis = await catalog.upsertAnalysis(analysis);
      if (!upsertedAnalysis.ok) return upsertedAnalysis;
      if (index % 500 === 499) report(`videos ${String(index + 1)}/${String(sizes.videos)}`);
    }
    return { ok: true, value: undefined } as const;
  });
  if (!seededVideos.ok) throw new Error(`seed videos failed: ${seededVideos.error.code}: ${seededVideos.error.message}`);

  const peopleIds: string[] = [];
  const seededFaces = await catalog.withBatch(async () => {
    for (let index = 0; index < sizes.people; index += 1) {
      const personId = `person_${String(index).padStart(6, '0')}`;
      peopleIds.push(personId);
      const person: Person = {
        personId,
        displayName: index % 4 === 0 ? `Subject ${String(index)}` : null,
        kind: 'face',
        createdAt: isoAt(index),
        centroid: embedding(random),
        exemplarCount: 3,
      };
      const upserted = await catalog.upsertPerson(person);
      if (!upserted.ok) return upserted;
      if (index % 500 === 499) report(`people ${String(index + 1)}/${String(sizes.people)}`);
    }
    for (let index = 0; index < sizes.faceObservations; index += 1) {
      const observation: FaceObservation = {
        obsId: `obs_${String(index).padStart(7, '0')}`,
        fingerprint: videoFingerprints[index % Math.max(videoFingerprints.length, 1)] ?? 'vid_0000000',
        kind: 'face',
        frameTsS: 1.5,
        bbox: { x: 10, y: 10, width: 80, height: 80 },
        embedding: embedding(random),
        quality: 0.8,
        personId: peopleIds[index % Math.max(peopleIds.length, 1)] ?? null,
        cropPath: null,
        media: 'video',
      };
      const upserted = await catalog.upsertFaceObservation(observation);
      if (!upserted.ok) return upserted;
      if (index % 2_000 === 1_999) report(`faces ${String(index + 1)}/${String(sizes.faceObservations)}`);
    }
    return { ok: true, value: undefined } as const;
  });
  if (!seededFaces.ok) throw new Error(`seed faces failed: ${seededFaces.error.code}: ${seededFaces.error.message}`);
  const flushedCatalog = await catalog.flush();
  if (!flushedCatalog.ok) throw new Error(`catalog flush failed: ${flushedCatalog.error.message}`);
  await catalog.dispose();

  const photos = new SqlJsPhotosStore({ homeDirectory: input.home });
  const photoFolder: PhotoFolderRecord = {
    folderId: 'path-00000001',
    currentPath: photoRoot,
    displayName: 'photos',
    firstSeenAt: isoAt(0),
    lastSeenAt: isoAt(0),
    defaultConfigId: null,
  };
  const configId = 'cfg_000000000001';
  const seededPhotos = await photos.withBatch(async () => {
    const upsertedFolder = await photos.upsertFolder(photoFolder);
    if (!upsertedFolder.ok) return upsertedFolder;
    const upsertedConfig = await photos.upsertAnalysisConfig({
      configId,
      descriptorJson: '{"analyzer":"harness"}',
      label: 'harness',
      now: isoAt(0),
    });
    if (!upsertedConfig.ok) return upsertedConfig;
    for (let index = 0; index < sizes.photos; index += 1) {
      const fingerprint = `ph_${index.toString(16).padStart(16, '0')}`;
      const fileName = `shot-${sentence(random, 1)}-${String(index)}.jpg`;
      const hasGps = index % 2 === 0;
      const photo: PhotoRecord = {
        fingerprint,
        folderId: photoFolder.folderId,
        fileName,
        currentPath: `${photoRoot}/${fileName}`,
        ext: 'jpg',
        size: 4_000_000,
        width: 6000,
        height: 4000,
        orientation: 1,
        cameraMake: null,
        cameraModel: null,
        lens: null,
        iso: null,
        fNumber: null,
        exposureTime: null,
        exifRating: null,
        capturedAt: isoAt(index),
        capturedAtSource: 'exif_offset',
        gpsLat: hasGps ? 50 + random() : null,
        gpsLon: hasGps ? 19 + random() : null,
        gpsSource: hasGps ? 'camera' : null,
        gpsAccuracyM: null,
        gpsIntervalKind: null,
        gpsResolvedAt: null,
        placeName: hasGps ? PLACES[index % PLACES.length] ?? null : null,
        placeRegion: null,
        placeCountry: null,
        placeCountryCode: null,
        placeDistanceM: null,
        placeDataset: hasGps ? 'bench' : null,
        discoveredAt: isoAt(index),
        exifReadAt: isoAt(index),
        proxyState: 'done',
        proxyWidth: 2048,
        proxyHeight: 1365,
        thumbState: 'done',
        missingAt: null,
        selectedConfigId: null,
      };
      const upsertedPhoto = await photos.upsertPhoto(photo);
      if (!upsertedPhoto.ok) return upsertedPhoto;
      const sighting: PhotoSightingRecord = {
        fingerprint,
        currentPath: photo.currentPath,
        folderId: photoFolder.folderId,
        size: photo.size,
        mtimeMs: 1_700_000_000_000,
        lastSeenAt: isoAt(index),
      };
      const upsertedSighting = await photos.upsertSighting(sighting);
      if (!upsertedSighting.ok) return upsertedSighting;
      const recorded = await photos.recordPhotoAnalysis({
        fingerprint,
        configId,
        description: sentence(random, 40),
        scene: sentence(random, 4),
        quality: 'good',
        language: 'pl',
        analyzer: 'harness',
        model: 'harness-1',
        batchSize: 1,
        usageJson: null,
        tags: pickTags(random, 5),
        createdAt: isoAt(index),
      });
      if (!recorded.ok) return recorded;
      if (index % 2_000 === 1_999) report(`photos ${String(index + 1)}/${String(sizes.photos)}`);
    }
    return { ok: true, value: undefined } as const;
  });
  if (!seededPhotos.ok) throw new Error(`seed photos failed: ${seededPhotos.error.code}: ${seededPhotos.error.message}`);
  const flushedPhotos = await photos.flush();
  if (!flushedPhotos.ok) throw new Error(`photos flush failed: ${flushedPhotos.error.message}`);
  await photos.dispose();

  return { home: input.home, sizes, videoRoot, photoRoot, elapsedMs: Date.now() - startedAt };
};
