export const CATALOG_DIR_NAME = '.ai-video-cataloger';
export const CATALOG_DB_FILE = 'catalog.db';
export const PHOTOS_DB_FILE = 'photos.db';
export const PROMOTED_MARKER_FILE = 'promoted-from.json';

export interface DbSnapshot {
  exists: boolean;
  schemaVersion: number;
}

export interface PromotedMarker {
  sourceHomeDirectory: string;
  sourceCatalogFingerprint: string;
  promotedAt: string;
}

export interface HomeSnapshot {
  homeDirectory: string;
  catalogDirectoryExists: boolean;
  catalogDb: DbSnapshot;
  photosDb: DbSnapshot;
  promotedMarker: PromotedMarker | null;
  catalogEntries: readonly string[];
  counts: {
    folders: number;
    files: number;
    analyses: number;
    photos: number;
  };
}

export type PhotosAction = 'carry-target' | 'keep-source' | 'none';

export interface PromotionPlan {
  sourceHomeDirectory: string;
  targetHomeDirectory: string;
  backupDirectory: string | null;
  photosAction: PhotosAction;
  carriedTargetEntries: readonly string[];
  replacedTargetEntries: readonly string[];
  sourceCatalogFingerprint: string;
  sourceCounts: HomeSnapshot['counts'];
}

export type PromotionBlockReason =
  | { kind: 'source_catalog_missing'; sourceHomeDirectory: string }
  | { kind: 'source_schema_too_new'; db: 'catalog' | 'photos'; found: number; supported: number }
  | { kind: 'photos_conflict' }
  | { kind: 'already_promoted'; promotedAt: string };

export type PromotionPlanResult =
  | { ok: true; plan: PromotionPlan }
  | { ok: false; reason: PromotionBlockReason };

export interface PromotionPlanInput {
  source: HomeSnapshot;
  target: HomeSnapshot;
  sourceCatalogFingerprint: string;
  supportedGlobalCatalogSchemaVersion: number;
  supportedPhotosSchemaVersion: number;
  backupDirectoryFor: (targetHomeDirectory: string) => string;
}

export const buildPromotionPlan = (input: PromotionPlanInput): PromotionPlanResult => {
  const { source, target, sourceCatalogFingerprint } = input;

  if (!source.catalogDb.exists) {
    return { ok: false, reason: { kind: 'source_catalog_missing', sourceHomeDirectory: source.homeDirectory } };
  }
  if (source.catalogDb.schemaVersion > input.supportedGlobalCatalogSchemaVersion) {
    return {
      ok: false,
      reason: {
        kind: 'source_schema_too_new',
        db: 'catalog',
        found: source.catalogDb.schemaVersion,
        supported: input.supportedGlobalCatalogSchemaVersion,
      },
    };
  }
  if (source.photosDb.exists && source.photosDb.schemaVersion > input.supportedPhotosSchemaVersion) {
    return {
      ok: false,
      reason: {
        kind: 'source_schema_too_new',
        db: 'photos',
        found: source.photosDb.schemaVersion,
        supported: input.supportedPhotosSchemaVersion,
      },
    };
  }
  if (source.photosDb.exists && target.photosDb.exists) {
    return { ok: false, reason: { kind: 'photos_conflict' } };
  }
  const marker = target.promotedMarker;
  if (
    marker !== null
    && marker.sourceHomeDirectory === source.homeDirectory
    && marker.sourceCatalogFingerprint === sourceCatalogFingerprint
  ) {
    return { ok: false, reason: { kind: 'already_promoted', promotedAt: marker.promotedAt } };
  }

  const photosAction: PhotosAction = source.photosDb.exists
    ? 'keep-source'
    : target.photosDb.exists
      ? 'carry-target'
      : 'none';

  const ownedByPromotion = new Set([...source.catalogEntries, PHOTOS_DB_FILE, PROMOTED_MARKER_FILE]);
  const survivingTargetEntries = target.catalogDirectoryExists
    ? [...target.catalogEntries].sort((left, right) => left.localeCompare(right))
    : [];

  return {
    ok: true,
    plan: {
      sourceHomeDirectory: source.homeDirectory,
      targetHomeDirectory: target.homeDirectory,
      backupDirectory: target.catalogDirectoryExists ? input.backupDirectoryFor(target.homeDirectory) : null,
      photosAction,
      carriedTargetEntries: survivingTargetEntries.filter((entry) => !ownedByPromotion.has(entry)),
      replacedTargetEntries: survivingTargetEntries.filter(
        (entry) => entry !== PHOTOS_DB_FILE && entry !== PROMOTED_MARKER_FILE && source.catalogEntries.includes(entry),
      ),
      sourceCatalogFingerprint,
      sourceCounts: source.counts,
    },
  };
};

export const describeBlockReason = (reason: PromotionBlockReason): string => {
  switch (reason.kind) {
    case 'source_catalog_missing':
      return `no catalog.db found under ${reason.sourceHomeDirectory}/${CATALOG_DIR_NAME}/ — nothing to promote.`;
    case 'source_schema_too_new':
      return `source ${reason.db}.db schema version ${String(reason.found)} is newer than the `
        + `supported version ${String(reason.supported)} — upgrade the app before promoting.`;
    case 'photos_conflict':
      return 'both the source and the target have a photos.db — merging two photo catalogs is out '
        + 'of scope for promote-home; resolve which one should win by hand, then re-run with only one present.';
    case 'already_promoted':
      return `this exact source was already promoted at ${reason.promotedAt} — nothing to do.`;
  }
};

export const describePlan = (plan: PromotionPlan): string => {
  const lines: string[] = [];
  lines.push(`source: ${plan.sourceHomeDirectory}/${CATALOG_DIR_NAME}`);
  lines.push(`target: ${plan.targetHomeDirectory}/${CATALOG_DIR_NAME}`);
  lines.push(
    plan.backupDirectory === null
      ? 'backup: nothing to back up (target has no existing catalog home)'
      : `backup: existing target catalog home -> ${plan.backupDirectory}`,
  );
  lines.push('install: copy the source catalog home over the target');
  switch (plan.photosAction) {
    case 'carry-target':
      lines.push('photos.db: source has none — the existing target photos.db is carried over verbatim');
      break;
    case 'keep-source':
      lines.push('photos.db: source has one and the target has none — the source\'s photos.db is installed');
      break;
    case 'none':
      lines.push('photos.db: neither home has one — nothing to carry');
      break;
  }
  lines.push(
    plan.carriedTargetEntries.length === 0
      ? 'kept from the target: nothing — the source provides every entry the target had'
      : `kept from the target: ${plan.carriedTargetEntries.join(', ')}`,
  );
  lines.push(
    plan.replacedTargetEntries.length === 0
      ? 'overwritten by the source: nothing'
      : `overwritten by the source: ${plan.replacedTargetEntries.join(', ')} (recoverable from the backup)`,
  );
  lines.push(
    `source counts: folders=${String(plan.sourceCounts.folders)} files=${String(plan.sourceCounts.files)} `
    + `analyses=${String(plan.sourceCounts.analyses)} photos=${String(plan.sourceCounts.photos)}`,
  );
  return lines.join('\n');
};
