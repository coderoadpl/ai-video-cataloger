import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import initSqlJs from 'sql.js';
import { z } from 'zod';

import { GLOBAL_CATALOG_SCHEMA_VERSION } from '@core/domain/index.js';
import { PHOTOS_SCHEMA_VERSION, SqlJsGlobalCatalogStore, SqlJsPhotosStore } from '@adapters/db/index.js';

import {
  buildPromotionPlan,
  CATALOG_DB_FILE,
  CATALOG_DIR_NAME,
  describeBlockReason,
  describePlan,
  PHOTOS_DB_FILE,
  PROMOTED_MARKER_FILE,
  type HomeSnapshot,
  type PromotionPlan,
} from './promote-home-plan.js';

const catalogDirOf = (homeDirectory: string): string => path.join(homeDirectory, CATALOG_DIR_NAME);

const catalogEntriesOf = (homeDirectory: string): readonly string[] => {
  const catalogDir = catalogDirOf(homeDirectory);
  return existsSync(catalogDir) ? readdirSync(catalogDir) : [];
};

const fingerprintOf = (filePath: string): string => {
  const stats = statSync(filePath);
  return `${String(stats.size)}:${String(stats.mtimeMs)}`;
};

const promotedMarkerSchema = z.object({
  sourceHomeDirectory: z.string(),
  sourceCatalogFingerprint: z.string(),
  promotedAt: z.string(),
});

const readMarker = (homeDirectory: string): HomeSnapshot['promotedMarker'] => {
  const markerPath = path.join(catalogDirOf(homeDirectory), PROMOTED_MARKER_FILE);
  if (!existsSync(markerPath)) return null;
  try {
    const parsed = promotedMarkerSchema.safeParse(JSON.parse(readFileSync(markerPath, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

interface ScratchInspection {
  catalog: { exists: boolean; schemaVersion: number; counts: { folders: number; files: number; analyses: number } };
  photos: { exists: boolean; schemaVersion: number; photos: number };
}

const readSchemaVersionRaw = async (filePath: string): Promise<number> => {
  const SQL = await initSqlJs();
  const client = new SQL.Database(readFileSync(filePath));
  try {
    const result = client.exec('SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1');
    const value = result[0]?.values[0]?.[0];
    return typeof value === 'number' ? value : 0;
  } catch {
    return 0;
  } finally {
    client.close();
  }
};

const inspectViaScratchCopy = async (
  homeDirectory: string,
  supportedGlobalCatalogSchemaVersion: number,
  supportedPhotosSchemaVersion: number,
): Promise<ScratchInspection> => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'avc-promote-home-'));
  try {
    const scratchCatalogDir = catalogDirOf(scratch);
    mkdirSync(scratchCatalogDir, { recursive: true });

    const sourceCatalogDb = path.join(catalogDirOf(homeDirectory), CATALOG_DB_FILE);
    const sourcePhotosDb = path.join(catalogDirOf(homeDirectory), PHOTOS_DB_FILE);

    const catalogExists = existsSync(sourceCatalogDb);
    let catalog: ScratchInspection['catalog'] = { exists: false, schemaVersion: 0, counts: { folders: 0, files: 0, analyses: 0 } };
    if (catalogExists) {
      const scratchCatalogDb = path.join(scratchCatalogDir, CATALOG_DB_FILE);
      cpSync(sourceCatalogDb, scratchCatalogDb);
      const version = await readSchemaVersionRaw(scratchCatalogDb);
      if (version > supportedGlobalCatalogSchemaVersion) {
        catalog = { exists: true, schemaVersion: version, counts: { folders: 0, files: 0, analyses: 0 } };
      } else {
        const store = new SqlJsGlobalCatalogStore({ homeDirectory: scratch });
        const counts = await store.counts();
        await store.dispose();
        if (!counts.ok) throw new Error(`could not read catalog.db under ${homeDirectory}: ${counts.error.message}`);
        catalog = { exists: true, schemaVersion: version, counts: counts.value };
      }
    }

    const photosExists = existsSync(sourcePhotosDb);
    let photos: ScratchInspection['photos'] = { exists: false, schemaVersion: 0, photos: 0 };
    if (photosExists) {
      const scratchPhotosDb = path.join(scratchCatalogDir, PHOTOS_DB_FILE);
      cpSync(sourcePhotosDb, scratchPhotosDb);
      const version = await readSchemaVersionRaw(scratchPhotosDb);
      if (version > supportedPhotosSchemaVersion) {
        photos = { exists: true, schemaVersion: version, photos: 0 };
      } else {
        const store = new SqlJsPhotosStore({ homeDirectory: scratch });
        const counts = await store.counts(null);
        await store.dispose();
        if (!counts.ok) throw new Error(`could not read photos.db under ${homeDirectory}: ${counts.error.message}`);
        photos = { exists: true, schemaVersion: version, photos: counts.value.photos };
      }
    }

    return { catalog, photos };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

// The target's db content is only ever inspected for existence (photos.db
// conflict check) — its rows and schema version are never read by
// buildPromotionPlan, and it's about to be backed up and replaced regardless,
// so it's never opened.
const readSnapshotShallow = (homeDirectory: string): HomeSnapshot => ({
  homeDirectory,
  catalogDirectoryExists: existsSync(catalogDirOf(homeDirectory)),
  catalogDb: { exists: existsSync(path.join(catalogDirOf(homeDirectory), CATALOG_DB_FILE)), schemaVersion: 0 },
  photosDb: { exists: existsSync(path.join(catalogDirOf(homeDirectory), PHOTOS_DB_FILE)), schemaVersion: 0 },
  promotedMarker: readMarker(homeDirectory),
  catalogEntries: catalogEntriesOf(homeDirectory),
  counts: { folders: 0, files: 0, analyses: 0, photos: 0 },
});

const readSnapshotDeep = async (
  homeDirectory: string,
  supportedGlobalCatalogSchemaVersion: number,
  supportedPhotosSchemaVersion: number,
): Promise<HomeSnapshot> => {
  const inspection = await inspectViaScratchCopy(
    homeDirectory,
    supportedGlobalCatalogSchemaVersion,
    supportedPhotosSchemaVersion,
  );
  return {
    homeDirectory,
    catalogDirectoryExists: existsSync(catalogDirOf(homeDirectory)),
    catalogDb: { exists: inspection.catalog.exists, schemaVersion: inspection.catalog.schemaVersion },
    photosDb: { exists: inspection.photos.exists, schemaVersion: inspection.photos.schemaVersion },
    promotedMarker: readMarker(homeDirectory),
    catalogEntries: catalogEntriesOf(homeDirectory),
    counts: {
      folders: inspection.catalog.counts.folders,
      files: inspection.catalog.counts.files,
      analyses: inspection.catalog.counts.analyses,
      photos: inspection.photos.photos,
    },
  };
};

const backupDirectoryFor = (targetHomeDirectory: string): string =>
  `${catalogDirOf(targetHomeDirectory)}.backup-${new Date().toISOString().replaceAll(':', '-')}`;

const executePlan = (plan: PromotionPlan): void => {
  const sourceCatalogDir = catalogDirOf(plan.sourceHomeDirectory);
  const targetCatalogDir = catalogDirOf(plan.targetHomeDirectory);

  let carriedPhotosDb: string | null = null;
  if (plan.backupDirectory !== null) {
    renameSync(targetCatalogDir, plan.backupDirectory);
    if (plan.photosAction === 'carry-target') {
      const backedUpPhotosDb = path.join(plan.backupDirectory, PHOTOS_DB_FILE);
      if (existsSync(backedUpPhotosDb)) carriedPhotosDb = backedUpPhotosDb;
    }
  }

  mkdirSync(path.dirname(targetCatalogDir), { recursive: true });
  cpSync(sourceCatalogDir, targetCatalogDir, { recursive: true });

  if (carriedPhotosDb !== null) {
    cpSync(carriedPhotosDb, path.join(targetCatalogDir, PHOTOS_DB_FILE));
  }

  if (plan.backupDirectory !== null) {
    for (const entry of plan.carriedTargetEntries) {
      cpSync(path.join(plan.backupDirectory, entry), path.join(targetCatalogDir, entry), { recursive: true });
    }
  }

  const marker = {
    sourceHomeDirectory: plan.sourceHomeDirectory,
    sourceCatalogFingerprint: plan.sourceCatalogFingerprint,
    promotedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(targetCatalogDir, PROMOTED_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
};

const repairChecklist = (plan: PromotionPlan): string[] => {
  const lines: string[] = [];
  if (plan.sourceCounts.photos > 0) {
    lines.push('pnpm run cli -- photos grid-thumbs');
    lines.push('pnpm run cli -- photos gps backfill <timeline.json>   # once a Timeline export is available');
  }
  if (plan.sourceCounts.files > 0) {
    lines.push('pnpm run cli -- gps backfill <timeline.json>   # once a Timeline export is available');
    lines.push('pnpm run cli -- faces recluster');
    lines.push('pnpm run cli -- faces exemplars');
  }
  return lines;
};

interface ParsedArgs {
  source: string;
  target: string;
  dryRun: boolean;
  yes: boolean;
}

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  let source: string | null = null;
  let target = process.env.AVC_HOME_DIRECTORY ?? homedir();
  let dryRun = false;
  let yes = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--source requires a path');
      source = path.resolve(value);
      index += 1;
    } else if (arg === '--target') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--target requires a path');
      target = path.resolve(value);
      index += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--yes') {
      yes = true;
    } else {
      throw new Error(`unrecognized argument: ${arg}`);
    }
  }
  if (source === null) throw new Error('--source <homeDirectory> is required');
  return { source, target, dryRun, yes };
};

export const run = async (argv: readonly string[]): Promise<{ code: number; output: string }> => {
  const output: string[] = [];
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'unrecognized arguments';
    return { code: 2, output: `promote-home: ${message}` };
  }

  const source = await readSnapshotDeep(args.source, GLOBAL_CATALOG_SCHEMA_VERSION, PHOTOS_SCHEMA_VERSION);
  const target = readSnapshotShallow(args.target);
  const fingerprintPath = path.join(catalogDirOf(args.source), CATALOG_DB_FILE);
  const sourceCatalogFingerprint = existsSync(fingerprintPath) ? fingerprintOf(fingerprintPath) : '';

  const result = buildPromotionPlan({
    source,
    target,
    sourceCatalogFingerprint,
    supportedGlobalCatalogSchemaVersion: GLOBAL_CATALOG_SCHEMA_VERSION,
    supportedPhotosSchemaVersion: PHOTOS_SCHEMA_VERSION,
    backupDirectoryFor,
  });

  if (!result.ok) {
    output.push(`promote-home: refused — ${describeBlockReason(result.reason)}`);
    return { code: 1, output: output.join('\n') };
  }

  output.push(describePlan(result.plan));

  if (args.dryRun) {
    output.push('', 'dry run — nothing written.');
    return { code: 0, output: output.join('\n') };
  }

  if (!args.yes) {
    output.push('', 'this would write to the target home. Re-run with --yes to execute, or --dry-run to only plan.');
    return { code: 1, output: output.join('\n') };
  }

  executePlan(result.plan);

  output.push('', 'promoted.');
  const checklist = repairChecklist(result.plan);
  if (checklist.length > 0) {
    output.push('', 'post-promotion repair checklist:');
    for (const line of checklist) output.push(`  ${line}`);
  }

  return { code: 0, output: output.join('\n') };
};

const isMain = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === `file://${entry}`;
};

if (isMain()) {
  const { code, output } = await run(process.argv.slice(2));
  console.log(output);
  process.exit(code);
}
