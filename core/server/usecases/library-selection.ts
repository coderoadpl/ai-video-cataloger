import {
  appError,
  ok,
  type AppError,
  type CatalogFile,
  type CatalogFolder,
  type LibrarySelectionScope,
  type Result,
} from '@core/domain/index.js';

import type {
  FileSystemPort,
  GlobalCatalogStore,
  PhotoRecord,
  PhotoSightingRecord,
  PhotosStore,
  MediaPort,
} from '../ports.js';
import { libraryCollection } from './collection.js';

export interface LibrarySelectionDeps {
  globalCatalog: GlobalCatalogStore;
  photos: PhotosStore;
  fs: FileSystemPort;
  media: MediaPort;
}

export interface LibrarySelectionSighting {
  folderId: string;
  rootPath: string;
  path: string;
}

export interface LibrarySelectionEntry {
  fingerprint: string;
  media: 'video' | 'photo';
  hiddenAt: number | null;
  sharedWithOtherPeople: boolean;
  sightings: LibrarySelectionSighting[];
}

export interface LibrarySelectionPreviewRoot {
  folderId: string;
  displayName: string;
  currentPath: string;
  fileCount: number;
  writable: boolean;
  online: boolean;
}

export interface LibrarySelectionPreviewOutput {
  total: number;
  videoCount: number;
  photoCount: number;
  hiddenCount: number;
  visibleCount: number;
  sharedWithOtherPeople: number;
  roots: LibrarySelectionPreviewRoot[];
}

export const resolveLibrarySelection = async (
  deps: LibrarySelectionDeps,
  scope: LibrarySelectionScope,
): Promise<Result<LibrarySelectionEntry[], AppError>> => {
  if (scope.kind === 'fingerprints') return resolveFingerprints(deps, scope.fingerprints);
  if (scope.kind === 'filter') return resolveFilter(deps, scope);
  return resolvePerson(deps, scope.personId, scope.skipSharedWithOtherPeople);
};

export const librarySelectionPreview = async (
  deps: LibrarySelectionDeps,
  input: { scope: LibrarySelectionScope },
): Promise<Result<LibrarySelectionPreviewOutput, AppError>> => {
  const entries = await resolveLibrarySelection(deps, input.scope);
  if (!entries.ok) return entries;
  const roots = await previewRoots(deps, entries.value);
  if (!roots.ok) return roots;
  return ok({
    total: entries.value.length,
    videoCount: entries.value.filter((entry) => entry.media === 'video').length,
    photoCount: entries.value.filter((entry) => entry.media === 'photo').length,
    hiddenCount: entries.value.filter((entry) => entry.hiddenAt !== null).length,
    visibleCount: entries.value.filter((entry) => entry.hiddenAt === null).length,
    sharedWithOtherPeople: entries.value.filter((entry) => entry.sharedWithOtherPeople).length,
    roots: roots.value,
  });
};

const resolveFingerprints = async (
  deps: LibrarySelectionDeps,
  fingerprints: readonly string[],
): Promise<Result<LibrarySelectionEntry[], AppError>> => {
  const entries: LibrarySelectionEntry[] = [];
  const unknown: string[] = [];
  for (const fingerprint of [...new Set(fingerprints)]) {
    const video = await deps.globalCatalog.getFile(fingerprint);
    if (!video.ok) return video;
    if (video.value !== null) {
      const entry = await videoEntry(deps, video.value, false);
      if (!entry.ok) return entry;
      entries.push(entry.value);
      continue;
    }
    const photo = await deps.photos.getPhoto(fingerprint);
    if (!photo.ok) return photo;
    if (photo.value !== null) {
      const entry = await photoEntry(deps, photo.value, false);
      if (!entry.ok) return entry;
      entries.push(entry.value);
      continue;
    }
    unknown.push(fingerprint);
  }
  if (unknown.length > 0) return { ok: false, error: appError('not_found', 'Unknown library fingerprint', { fingerprints: unknown }) };
  if (entries.length === 0) return { ok: false, error: appError('validation', 'Selection resolved to zero files') };
  return ok(entries);
};

const resolveFilter = async (
  deps: LibrarySelectionDeps,
  scope: Extract<LibrarySelectionScope, { kind: 'filter' }>,
): Promise<Result<LibrarySelectionEntry[], AppError>> => {
  const fingerprints: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await libraryCollection(deps, {
      query: scope.filter.query ?? null,
      filters: {
        tags: scope.filter.tags,
        people: scope.filter.people,
        place: scope.filter.place ?? null,
        from: scope.filter.from ?? null,
        to: scope.filter.to ?? null,
        hasGps: scope.filter.hasGps,
        folderId: scope.filter.folderId ?? null,
        hideUnavailable: scope.filter.hideUnavailable,
        hidden: scope.filter.hidden,
      },
      sort: 'captured_desc',
      media: scope.filter.media,
      limit: 200,
      cursor,
    });
    if (!page.ok) return page;
    fingerprints.push(...page.value.items.map((item) => item.fingerprint));
    cursor = page.value.nextCursor;
  } while (cursor !== null);
  if (fingerprints.length === 0) return { ok: false, error: appError('validation', 'Selection resolved to zero files') };
  return resolveFingerprints(deps, fingerprints);
};

const resolvePerson = async (
  deps: LibrarySelectionDeps,
  personId: string,
  skipSharedWithOtherPeople: boolean,
): Promise<Result<LibrarySelectionEntry[], AppError>> => {
  const person = await deps.globalCatalog.getPerson(personId);
  if (!person.ok) return person;
  if (person.value === null) return { ok: false, error: appError('not_found', 'Person not found', { personId }) };
  const observations = await deps.globalCatalog.listFaceObservations();
  if (!observations.ok) return observations;
  const selected = new Set(observations.value.filter((observation) => observation.personId === personId).map((observation) => observation.fingerprint));
  const shared = sharedFingerprints(observations.value, personId);
  const fingerprints = [...selected].filter((fingerprint) => !skipSharedWithOtherPeople || !shared.has(fingerprint));
  if (fingerprints.length === 0) return { ok: false, error: appError('validation', 'Selection resolved to zero files') };
  const resolved = await resolveFingerprints(deps, fingerprints);
  if (!resolved.ok) return resolved;
  return ok(resolved.value.map((entry) => ({ ...entry, sharedWithOtherPeople: shared.has(entry.fingerprint) })));
};

const sharedFingerprints = (
  observations: readonly { fingerprint: string; personId: string | null }[],
  personId: string,
): Set<string> => {
  const selected = new Set(observations.filter((observation) => observation.personId === personId).map((observation) => observation.fingerprint));
  const shared = new Set<string>();
  for (const observation of observations) {
    if (!selected.has(observation.fingerprint)) continue;
    if (observation.personId !== null && observation.personId !== personId) shared.add(observation.fingerprint);
  }
  return shared;
};

const videoEntry = async (
  deps: LibrarySelectionDeps,
  file: CatalogFile,
  sharedWithOtherPeople: boolean,
): Promise<Result<LibrarySelectionEntry, AppError>> => {
  const folder = await deps.globalCatalog.getFolder(file.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null) return { ok: false, error: appError('not_found', 'Catalog folder not found', { folderId: file.folderId }) };
  return ok({
    fingerprint: file.fingerprint,
    media: 'video',
    hiddenAt: file.hiddenAt ?? null,
    sharedWithOtherPeople,
    sightings: [videoSighting(deps, file, folder.value)],
  });
};

const videoSighting = (deps: LibrarySelectionDeps, file: CatalogFile, folder: CatalogFolder): LibrarySelectionSighting => ({
  folderId: folder.folderId,
  rootPath: folder.currentPath,
  path: deps.fs.join(folder.currentPath, file.fileName),
});

const photoEntry = async (
  deps: LibrarySelectionDeps,
  photo: PhotoRecord,
  sharedWithOtherPeople: boolean,
): Promise<Result<LibrarySelectionEntry, AppError>> => {
  const sightings = await deps.photos.listSightings(photo.fingerprint);
  if (!sightings.ok) return sightings;
  const resolvedSightings: LibrarySelectionSighting[] = [];
  for (const sighting of sightings.value.length === 0 ? [photoSightingFromRecord(photo)] : sightings.value) {
    const folder = await deps.photos.getFolder(sighting.folderId);
    if (!folder.ok) return folder;
    resolvedSightings.push({
      folderId: sighting.folderId,
      rootPath: folder.value?.currentPath ?? deps.fs.dirname(sighting.currentPath),
      path: sighting.currentPath,
    });
  }
  return ok({
    fingerprint: photo.fingerprint,
    media: 'photo',
    hiddenAt: photo.hiddenAt ?? null,
    sharedWithOtherPeople,
    sightings: resolvedSightings,
  });
};

const photoSightingFromRecord = (photo: PhotoRecord): PhotoSightingRecord => ({
  fingerprint: photo.fingerprint,
  currentPath: photo.currentPath,
  folderId: photo.folderId,
  size: photo.size,
  mtimeMs: 0,
  lastSeenAt: photo.discoveredAt,
});

const previewRoots = async (
  deps: LibrarySelectionDeps,
  entries: readonly LibrarySelectionEntry[],
): Promise<Result<LibrarySelectionPreviewRoot[], AppError>> => {
  const rootMap = new Map<string, LibrarySelectionPreviewRoot>();
  for (const entry of entries) {
    for (const sighting of entry.sightings) {
      const key = `${sighting.folderId}\u0000${sighting.rootPath}`;
      const existing = rootMap.get(key);
      if (existing !== undefined) {
        rootMap.set(key, { ...existing, fileCount: existing.fileCount + 1 });
        continue;
      }
      const online = await deps.fs.exists(sighting.rootPath);
      if (!online.ok) return online;
      const writable = await deps.fs.isWritable(sighting.rootPath);
      if (!writable.ok) return writable;
      rootMap.set(key, {
        folderId: sighting.folderId,
        displayName: deps.fs.basename(sighting.rootPath),
        currentPath: sighting.rootPath,
        fileCount: 1,
        writable: writable.value,
        online: online.value,
      });
    }
  }
  return ok([...rootMap.values()].sort((left, right) => left.currentPath.localeCompare(right.currentPath)));
};
