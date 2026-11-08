import {
  appError,
  canonicalPath,
  compareUtf8Bytes,
  derivedFolderId,
  err,
  isDerivedFolderId,
  isPathUnderRoot,
  ok,
  rebasePath,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import type {
  FileSystemPort,
  FolderRelocation,
  GlobalCatalogStore,
  PathPrefixRewrite,
  PhotosStore,
  RootRelocationInput,
} from '../ports.js';
import { legacyReadOnlyArtifactRoot, readOnlyArtifactRootById } from './artifact-root.js';

export type RelocateRootMedia = 'video' | 'photo' | 'all';
export type RelocateRootDatabaseMedia = Exclude<RelocateRootMedia, 'all'>;

const RELOCATE_ROOT_EXAMPLE_LIMIT = 20;

export interface RelocateRootDeps {
  globalCatalog: GlobalCatalogStore;
  photos: PhotosStore;
  fs: FileSystemPort;
  now?: (() => Date) | undefined;
}

export interface RelocateRootInput {
  from: string;
  to: string;
  media: RelocateRootMedia;
  apply: boolean;
}

export interface RelocateRootFolderChange {
  fromPath: string;
  toPath: string;
  fromFolderId: string;
  toFolderId: string;
  mirror: PathPrefixRewrite | null;
}

export interface RelocateRootDatabasePlan {
  media: RelocateRootDatabaseMedia;
  databasePath: string;
  folders: number;
  files: number;
  paths: number;
  idChanges: number;
  mirrorsToRename: number;
  runs: number;
  gridThumbnails: number;
  examples: RelocateRootFolderChange[];
}

export type RelocateRootCollisionKind = 'folder_id' | 'folder_path' | 'mirror' | 'photo_path';

export interface RelocateRootCollision {
  media: RelocateRootDatabaseMedia;
  kind: RelocateRootCollisionKind;
  fromPath: string;
  target: string;
}

export interface RelocateRootRemaining {
  media: RelocateRootDatabaseMedia;
  folders: number;
  paths: number;
  runs: number;
}

export interface RelocateRootOutput {
  from: string;
  to: string;
  media: RelocateRootMedia;
  apply: boolean;
  applied: boolean;
  targetMounted: boolean;
  databases: RelocateRootDatabasePlan[];
  collisions: RelocateRootCollision[];
  warnings: string[];
  backupDirectory: string | null;
  remaining: RelocateRootRemaining[] | null;
}

interface DatabasePlan {
  summary: RelocateRootDatabasePlan;
  changes: RelocateRootFolderChange[];
  relocation: RootRelocationInput;
  collisions: RelocateRootCollision[];
  warnings: string[];
}

interface FolderRow {
  folderId: string;
  currentPath: string;
  displayName: string;
}

export const relocateRoot = async (
  deps: RelocateRootDeps,
  input: RelocateRootInput,
): Promise<Result<RelocateRootOutput, AppError>> => {
  const roots = resolveRoots(deps.fs, input);
  if (!roots.ok) return roots;
  const { from, to } = roots.value;

  const planned = await planDatabases(deps, from, to, input.media);
  if (!planned.ok) return planned;
  const plans = planned.value;
  const collisions = plans.flatMap((plan) => plan.collisions);
  const warnings = plans.flatMap((plan) => plan.warnings);

  const mounted = await targetMountWarnings(deps.fs, to, plans);
  if (!mounted.ok) return mounted;
  warnings.push(...mounted.value.warnings);

  const output: RelocateRootOutput = {
    from,
    to,
    media: input.media,
    apply: input.apply,
    applied: false,
    targetMounted: mounted.value.mounted,
    databases: plans.map((plan) => plan.summary),
    collisions,
    warnings,
    backupDirectory: null,
    remaining: null,
  };
  if (!input.apply) return ok(output);
  if (collisions.length > 0) return err(collisionError(collisions));

  const locked = await deps.globalCatalog.acquireWriteLock();
  if (!locked.ok) return locked;
  if (!locked.value.writable) {
    return err(appError('catalog_locked', 'The catalog is in use by another process; close the app and retry', locked.value.blockedBy));
  }

  const backedUp = await backupDatabases(deps);
  if (!backedUp.ok) return backedUp;
  output.backupDirectory = backedUp.value;

  const appliedResult = await applyPlans(deps, plans, backedUp.value);
  if (!appliedResult.ok) return appliedResult;
  output.applied = true;

  const verified = await planDatabases(deps, from, to, input.media);
  if (!verified.ok) return verified;
  output.remaining = verified.value.map((plan) => ({
    media: plan.summary.media,
    folders: plan.summary.folders,
    paths: plan.summary.media === 'photo' ? plan.summary.paths : plan.summary.files,
    runs: plan.summary.runs,
  }));
  const leftover = output.remaining.filter((entry) => entry.folders + entry.paths + entry.runs > 0);
  if (leftover.length > 0) {
    output.warnings.push(`Rows still reference ${from} after the rewrite: ${leftover.map(remainingLabel).join('; ')}`);
  }
  return ok(output);
};

const resolveRoots = (
  fs: FileSystemPort,
  input: RelocateRootInput,
): Result<{ from: string; to: string }, AppError> => {
  if (!input.from.startsWith('/') || !input.to.startsWith('/')) {
    return err(appError('validation', 'Both --from and --to must be absolute paths', { from: input.from, to: input.to }));
  }
  const from = normalizeRoot(fs, input.from);
  const to = normalizeRoot(fs, input.to);
  if (from === '/' || to === '/') {
    return err(appError('validation', 'The filesystem root cannot be relocated or be a relocation target', { from, to }));
  }
  if (from === to) return err(appError('validation', 'The old and the new root are the same path', { from, to }));
  if (isPathUnderRoot(to, from)) {
    return err(appError('validation', 'The new root cannot lie inside the old root', { from, to }));
  }
  return ok({ from, to });
};

const normalizeRoot = (fs: FileSystemPort, value: string): string =>
  canonicalPath(fs.resolve(value)).replace(/(?<=.)\/+$/, '');

const planDatabases = async (
  deps: RelocateRootDeps,
  from: string,
  to: string,
  media: RelocateRootMedia,
): Promise<Result<DatabasePlan[], AppError>> => {
  const plans: DatabasePlan[] = [];
  if (media !== 'photo') {
    const video = await planVideoDatabase(deps, from, to);
    if (!video.ok) return video;
    plans.push(video.value);
  }
  if (media !== 'video') {
    const photo = await planPhotoDatabase(deps, from, to);
    if (!photo.ok) return photo;
    plans.push(photo.value);
  }
  return ok(plans);
};

const planVideoDatabase = async (
  deps: RelocateRootDeps,
  from: string,
  to: string,
): Promise<Result<DatabasePlan, AppError>> => {
  const listed = await deps.globalCatalog.listFolders();
  if (!listed.ok) return listed;
  const planned = planFolders(deps.fs, 'video', listed.value, from, to);
  const warnings: string[] = [];
  const collisions = [...planned.collisions];
  for (const change of planned.changes) {
    if (change.toFolderId === change.fromFolderId) {
      const pathKeyed = await existingPath(deps.fs, readOnlyArtifactRootById(deps.fs, derivedFolderId(change.fromPath)).path);
      if (!pathKeyed.ok) return pathKeyed;
      if (pathKeyed.value !== null) {
        warnings.push(`Folder ${change.fromPath} keeps its marker id; the path-keyed mirror ${pathKeyed.value} is left in place`);
      }
      continue;
    }
    const target = readOnlyArtifactRootById(deps.fs, change.toFolderId).path;
    const targetExists = await deps.fs.exists(target);
    if (!targetExists.ok) return targetExists;
    if (targetExists.value) {
      collisions.push({ media: 'video', kind: 'mirror', fromPath: change.fromPath, target });
      continue;
    }
    const source = await mirrorSource(deps.fs, change);
    if (!source.ok) return source;
    if (source.value.leftover !== null) {
      warnings.push(`Folder ${change.fromPath} has a second, pre-canonical mirror ${source.value.leftover}; it is left in place`);
    }
    if (source.value.path !== null) change.mirror = { from: source.value.path, to: target };
  }
  const relocation = relocationInput(from, to, planned.changes, planned.folders);
  const stats = await deps.globalCatalog.rootRelocationStats(relocation);
  if (!stats.ok) return stats;
  return ok({
    summary: {
      media: 'video',
      databasePath: deps.globalCatalog.databasePath(),
      folders: planned.changes.length,
      files: stats.value.files,
      paths: 0,
      idChanges: countIdChanges(planned.changes),
      mirrorsToRename: planned.changes.filter((change) => change.mirror !== null).length,
      runs: stats.value.driveRuns,
      gridThumbnails: stats.value.gridThumbnails,
      examples: planned.changes.slice(0, RELOCATE_ROOT_EXAMPLE_LIMIT),
    },
    changes: planned.changes,
    relocation,
    collisions,
    warnings,
  });
};

const planPhotoDatabase = async (
  deps: RelocateRootDeps,
  from: string,
  to: string,
): Promise<Result<DatabasePlan, AppError>> => {
  const listed = await deps.photos.listFolders();
  if (!listed.ok) return listed;
  const planned = planFolders(deps.fs, 'photo', listed.value, from, to);
  const stats = await deps.photos.rootRelocationStats(from, to);
  if (!stats.ok) return stats;
  const collisions = [
    ...planned.collisions,
    ...stats.value.pathCollisions.map((fromPath): RelocateRootCollision => ({
      media: 'photo',
      kind: 'photo_path',
      fromPath,
      target: rebasePath(fromPath, from, to) ?? fromPath,
    })),
  ];
  return ok({
    summary: {
      media: 'photo',
      databasePath: deps.photos.databasePath(),
      folders: planned.changes.length,
      files: stats.value.photos,
      paths: stats.value.paths,
      idChanges: countIdChanges(planned.changes),
      mirrorsToRename: 0,
      runs: stats.value.runs,
      gridThumbnails: 0,
      examples: planned.changes.slice(0, RELOCATE_ROOT_EXAMPLE_LIMIT),
    },
    changes: planned.changes,
    relocation: relocationInput(from, to, planned.changes, planned.folders),
    collisions,
    warnings: [],
  });
};

const planFolders = (
  fs: FileSystemPort,
  media: RelocateRootDatabaseMedia,
  rows: readonly FolderRow[],
  from: string,
  to: string,
): { changes: RelocateRootFolderChange[]; folders: FolderRelocation[]; collisions: RelocateRootCollision[] } => {
  const moving = rows
    .filter((row) => isPathUnderRoot(row.currentPath, from))
    .sort((left, right) => compareUtf8Bytes(canonicalPath(left.currentPath), canonicalPath(right.currentPath)));
  const movingIds = new Set(moving.map((row) => row.folderId));
  const existingIds = new Set(rows.map((row) => row.folderId));
  const stayingPaths = new Set(rows.filter((row) => !movingIds.has(row.folderId)).map((row) => canonicalPath(row.currentPath)));
  const claimedIds = new Map<string, string>();
  const changes: RelocateRootFolderChange[] = [];
  const folders: FolderRelocation[] = [];
  const collisions: RelocateRootCollision[] = [];
  for (const row of moving) {
    const fromPath = canonicalPath(row.currentPath);
    const toPath = rebasePath(fromPath, from, to) ?? fromPath;
    const toFolderId = isDerivedFolderId(row.folderId) ? derivedFolderId(toPath) : row.folderId;
    if (toFolderId !== row.folderId && (existingIds.has(toFolderId) || claimedIds.has(toFolderId))) {
      collisions.push({ media, kind: 'folder_id', fromPath, target: toFolderId });
    }
    if (stayingPaths.has(toPath)) collisions.push({ media, kind: 'folder_path', fromPath, target: toPath });
    claimedIds.set(toFolderId, fromPath);
    changes.push({ fromPath, toPath, fromFolderId: row.folderId, toFolderId, mirror: null });
    folders.push({
      fromFolderId: row.folderId,
      toFolderId,
      toPath,
      displayName: row.displayName === fs.basename(fromPath) ? fs.basename(toPath) : row.displayName,
    });
  }
  return { changes, folders, collisions };
};

const relocationInput = (
  from: string,
  to: string,
  changes: readonly RelocateRootFolderChange[],
  folders: readonly FolderRelocation[],
): RootRelocationInput => ({
  fromRoot: from,
  toRoot: to,
  folders,
  pathPrefixes: [
    { from, to },
    ...changes.flatMap((change) => (change.mirror === null ? [] : [change.mirror])),
  ],
});

const mirrorSource = async (
  fs: FileSystemPort,
  change: RelocateRootFolderChange,
): Promise<Result<{ path: string | null; leftover: string | null }, AppError>> => {
  const byId = await existingPath(fs, readOnlyArtifactRootById(fs, change.fromFolderId).path);
  if (!byId.ok) return byId;
  const legacyPath = legacyReadOnlyArtifactRoot(fs, change.fromPath).path;
  const legacy = byId.value === legacyPath ? ok(null) : await existingPath(fs, legacyPath);
  if (!legacy.ok) return legacy;
  if (byId.value !== null) return ok({ path: byId.value, leftover: legacy.value });
  return ok({ path: legacy.value, leftover: null });
};

const existingPath = async (fs: FileSystemPort, candidate: string): Promise<Result<string | null, AppError>> => {
  const exists = await fs.isDirectory(candidate);
  if (!exists.ok) return exists;
  return ok(exists.value ? candidate : null);
};

const countIdChanges = (changes: readonly RelocateRootFolderChange[]): number =>
  changes.filter((change) => change.toFolderId !== change.fromFolderId).length;

const targetMountWarnings = async (
  fs: FileSystemPort,
  to: string,
  plans: readonly DatabasePlan[],
): Promise<Result<{ mounted: boolean; warnings: string[] }, AppError>> => {
  const mounted = await fs.isDirectory(to);
  if (!mounted.ok) return mounted;
  if (!mounted.value) {
    return ok({ mounted: false, warnings: [`${to} is not mounted; folder existence under the new root was not checked`] });
  }
  const targets = [...new Set(plans.flatMap((plan) => plan.changes.map((change) => change.toPath)))].sort(compareUtf8Bytes);
  const probes = [...new Set([targets[0], targets.at(-1)].filter((value): value is string => value !== undefined))];
  const warnings: string[] = [];
  for (const probe of probes) {
    const exists = await fs.isDirectory(probe);
    if (!exists.ok) return exists;
    if (!exists.value) warnings.push(`Planned folder ${probe} does not exist under the mounted new root`);
  }
  return ok({ mounted: true, warnings });
};

const backupDatabases = async (deps: RelocateRootDeps): Promise<Result<string, AppError>> => {
  const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const directory = deps.fs.join(deps.fs.homeDirectory(), '.ai-video-cataloger', 'backups', `${stamp}--relocate-root`);
  const catalog = await deps.globalCatalog.snapshotTo(deps.fs.join(directory, deps.fs.basename(deps.globalCatalog.databasePath())));
  if (!catalog.ok) return catalog;
  const photos = await deps.photos.snapshotTo(deps.fs.join(directory, deps.fs.basename(deps.photos.databasePath())));
  if (!photos.ok) return photos;
  return ok(directory);
};

const applyPlans = async (
  deps: RelocateRootDeps,
  plans: readonly DatabasePlan[],
  backupDirectory: string,
): Promise<Result<void, AppError>> => {
  for (const plan of plans) {
    if (!planHasChanges(plan.summary)) continue;
    const applied = plan.summary.media === 'video'
      ? await applyVideoPlan(deps, plan)
      : await applyPhotoPlan(deps, plan);
    if (!applied.ok) {
      const done = plans.slice(0, plans.indexOf(plan)).map((entry) => entry.summary.media);
      return err(appError(applied.error.code, `${applied.error.message} (already rewritten: ${done.length === 0 ? 'none' : done.join(', ')}; backups in ${backupDirectory})`, {
        cause: applied.error.details,
        rewritten: done,
        backupDirectory,
      }));
    }
  }
  return ok(undefined);
};

const planHasChanges = (summary: RelocateRootDatabasePlan): boolean =>
  summary.folders + summary.files + summary.paths + summary.runs + summary.gridThumbnails > 0;

const applyVideoPlan = async (deps: RelocateRootDeps, plan: DatabasePlan): Promise<Result<void, AppError>> => {
  const renamed: PathPrefixRewrite[] = [];
  for (const change of plan.changes) {
    if (change.mirror === null) continue;
    const moved = await deps.fs.renamePath(change.mirror.from, change.mirror.to);
    if (!moved.ok) {
      await rollbackMirrors(deps.fs, renamed);
      return moved;
    }
    renamed.push(change.mirror);
  }
  const rewritten = await deps.globalCatalog.relocateRoot(plan.relocation);
  if (!rewritten.ok) {
    await rollbackMirrors(deps.fs, renamed);
    return rewritten;
  }
  return deps.globalCatalog.flush();
};

const applyPhotoPlan = async (deps: RelocateRootDeps, plan: DatabasePlan): Promise<Result<void, AppError>> => {
  const rewritten = await deps.photos.relocateRoot(plan.relocation);
  if (!rewritten.ok) return rewritten;
  return deps.photos.flush();
};

const rollbackMirrors = async (fs: FileSystemPort, renamed: readonly PathPrefixRewrite[]): Promise<void> => {
  for (const mirror of [...renamed].reverse()) await fs.renamePath(mirror.to, mirror.from);
};

const collisionError = (collisions: readonly RelocateRootCollision[]): AppError => {
  const listed = collisions.slice(0, RELOCATE_ROOT_EXAMPLE_LIMIT)
    .map((collision) => `${collision.media} ${collision.kind}: ${collision.fromPath} -> ${collision.target}`)
    .join('; ');
  const more = collisions.length > RELOCATE_ROOT_EXAMPLE_LIMIT ? ` (+${String(collisions.length - RELOCATE_ROOT_EXAMPLE_LIMIT)} more)` : '';
  return appError('conflict', `Relocation aborted before any write: ${String(collisions.length)} collision(s): ${listed}${more}`, { collisions });
};

const remainingLabel = (entry: RelocateRootRemaining): string =>
  `${entry.media}: ${String(entry.folders)} folders, ${String(entry.paths)} paths, ${String(entry.runs)} runs`;
