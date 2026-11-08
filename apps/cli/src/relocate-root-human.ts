import type { ApiClient } from '@core/client/index.js';
import type { AppError, Result } from '@core/domain/index.js';

export type RelocateRootOutput = Awaited<ReturnType<ApiClient['indexRelocateRoot']>> extends Result<infer T, AppError> ? T : never;
type DatabasePlan = RelocateRootOutput['databases'][number];

const databaseLines = (plan: DatabasePlan): string[] => {
  const counts = plan.media === 'video'
    ? `${String(plan.folders)} folders, ${String(plan.files)} files, ${String(plan.idChanges)} ids change, `
      + `${String(plan.mirrorsToRename)} mirrors to rename, ${String(plan.runs)} drive runs, ${String(plan.gridThumbnails)} grid thumbnails`
    : `${String(plan.folders)} folders, ${String(plan.files)} photos, ${String(plan.paths)} photo paths, `
      + `${String(plan.idChanges)} ids change, ${String(plan.runs)} photo runs`;
  const examples = plan.examples.map((change) => {
    const id = change.toFolderId === change.fromFolderId ? change.fromFolderId : `${change.fromFolderId} -> ${change.toFolderId}`;
    return `  ${change.fromPath} -> ${change.toPath} [${id}]${change.mirror === null ? '' : ' (mirror renamed)'}`;
  });
  const more = plan.folders > plan.examples.length ? [`  ... and ${String(plan.folders - plan.examples.length)} more folders`] : [];
  return [`${plan.media} (${plan.databasePath}): ${counts}`, ...examples, ...more];
};

export const relocateRootHuman = (data: RelocateRootOutput): string => {
  const header = data.applied
    ? `Rewrote ${data.from} -> ${data.to}`
    : `Dry run: ${data.from} -> ${data.to} (nothing changed; add --apply to rewrite)`;
  const collisions = data.collisions.length === 0
    ? []
    : [
      `Collisions (${String(data.collisions.length)}); --apply refuses to run until they are resolved:`,
      ...data.collisions.map((collision) => `  ${collision.media} ${collision.kind}: ${collision.fromPath} -> ${collision.target}`),
    ];
  const warnings = data.warnings.map((warning) => `Warning: ${warning}`);
  const backup = data.backupDirectory === null ? [] : [`Backups: ${data.backupDirectory}`];
  const remaining = data.remaining === null
    ? []
    : [`Remaining under ${data.from}: ${data.remaining
      .map((entry) => `${entry.media} ${String(entry.folders)} folders, ${String(entry.paths)} paths, ${String(entry.runs)} runs`)
      .join('; ')}`];
  return [header, ...data.databases.flatMap(databaseLines), ...collisions, ...warnings, ...backup, ...remaining].join('\n');
};

export const relocateRootIncomplete = (data: RelocateRootOutput): boolean =>
  data.collisions.length > 0
  || (data.remaining ?? []).some((entry) => entry.folders + entry.paths + entry.runs > 0);
