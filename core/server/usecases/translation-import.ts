import { z } from 'zod';

import {
  appError,
  buildTranslationConfigDescriptor,
  configId,
  normalizeTagList,
  ok,
  type AppError,
  type CatalogVariant,
  type ConfigDescriptor,
  type Result,
} from '@core/domain/index.js';

import type { FileSystemPort, GlobalCatalogStore } from '../ports.js';
import { discoverArtifactRoot } from './artifact-root.js';
import {
  materializeTranslatedVariantArtifacts,
  variantArtifactPaths,
  variantProjectionSource,
} from './artifact-store.js';

const sourceConfigIdSchema = z.union([z.literal('legacy'), z.string().regex(/^cfg_[0-9a-f]{12}$/)]);
const translationImportInputSchema = z.object({
  ndjsonPath: z.string().min(1),
  dryRun: z.boolean(),
  select: z.boolean(),
}).strict();

export const translationImportRowSchema = z.object({
  fingerprint: z.string().trim().min(1),
  sourceConfigId: sourceConfigIdSchema,
  sourceDescription: z.string(),
  sourceTags: z.array(z.string()),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)),
  finalName: z.string().trim().min(1).nullable(),
  translator: z.object({
    provider: z.literal('codex'),
    model: z.string().trim().min(1),
  }).strict(),
}).strict();

export type TranslationImportRow = z.output<typeof translationImportRowSchema>;

export type TranslationImportInput = z.output<typeof translationImportInputSchema>;

export interface TranslationImportProgressRow {
  line: number;
  fingerprint: string | null;
  sourceConfigId: string | null;
  configId: string | null;
  outcome: 'created' | 'updated' | 'skipped';
  reason: string | null;
}

export interface TranslationImportSummary {
  ndjsonPath: string;
  dryRun: boolean;
  select: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  selected: number;
  rows: TranslationImportProgressRow[];
}

export interface TranslationImportDeps {
  globalCatalog: GlobalCatalogStore;
  fs: FileSystemPort;
}

interface TranslationImportPlan {
  row: TranslationImportRow;
  descriptor: ConfigDescriptor;
  configId: string;
  source: CatalogVariant;
  createdAt: string;
  line: number;
}

interface ParsedTranslationLine {
  line: number;
  row: TranslationImportRow | null;
  reason: string | null;
}

export const importTranslationVariants = async (
  deps: TranslationImportDeps,
  input: TranslationImportInput,
): Promise<Result<TranslationImportSummary, AppError>> => {
  const validated = translationImportInputSchema.safeParse(input);
  if (!validated.success) return { ok: false, error: appError('validation', validated.error.message) };
  const request = validated.data;
  const inputPath = deps.fs.resolve(request.ndjsonPath);
  const text = await deps.fs.readTextFile(inputPath);
  if (!text.ok) return text;
  if (text.value === null) {
    return { ok: false, error: appError('file_not_found', `File not found: ${inputPath}`) };
  }

  const parsedLines = parseTranslationLines(text.value);
  const rows: TranslationImportProgressRow[] = [];
  const plans: TranslationImportPlan[] = [];
  const plannedCreatedAt = new Map<string, string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;

  for (const parsedLine of parsedLines) {
    if (parsedLine.row === null) {
      skipped += 1;
      invalid += 1;
      rows.push({
        line: parsedLine.line,
        fingerprint: null,
        sourceConfigId: null,
        configId: null,
        outcome: 'skipped',
        reason: parsedLine.reason,
      });
      continue;
    }
    const source = await deps.globalCatalog.getVariant(parsedLine.row.fingerprint, parsedLine.row.sourceConfigId);
    if (!source.ok) return source;
    if (source.value === null) {
      skipped += 1;
      invalid += 1;
      rows.push({
        line: parsedLine.line,
        fingerprint: parsedLine.row.fingerprint,
        sourceConfigId: parsedLine.row.sourceConfigId,
        configId: null,
        outcome: 'skipped',
        reason: 'source_variant_not_found',
      });
      continue;
    }
    const descriptor = buildTranslationConfigDescriptor({
      providerId: parsedLine.row.translator.provider,
      model: parsedLine.row.translator.model,
      sourceConfigId: parsedLine.row.sourceConfigId,
    });
    const translatedConfigId = configId(descriptor);
    const key = `${parsedLine.row.fingerprint}\u0000${translatedConfigId}`;
    const earlierCreatedAt = plannedCreatedAt.get(key);
    let createdAt = earlierCreatedAt;
    let outcome: TranslationImportProgressRow['outcome'] = 'updated';
    if (createdAt === undefined) {
      const existing = await deps.globalCatalog.getVariant(parsedLine.row.fingerprint, translatedConfigId);
      if (!existing.ok) return existing;
      if (existing.value === null) {
        createdAt = new Date().toISOString();
        outcome = 'created';
      } else {
        createdAt = existing.value.createdAt;
      }
      plannedCreatedAt.set(key, createdAt);
    }
    if (outcome === 'created') created += 1;
    else updated += 1;
    plans.push({
      row: parsedLine.row,
      descriptor,
      configId: translatedConfigId,
      source: source.value,
      createdAt,
      line: parsedLine.line,
    });
    rows.push({
      line: parsedLine.line,
      fingerprint: parsedLine.row.fingerprint,
      sourceConfigId: parsedLine.row.sourceConfigId,
      configId: translatedConfigId,
      outcome,
      reason: null,
    });
  }

  const summary = (): TranslationImportSummary => ({
    ndjsonPath: inputPath,
    dryRun: request.dryRun,
    select: request.select,
    total: parsedLines.length,
    created,
    updated,
    skipped,
    invalid,
    selected: request.select ? plans.length : 0,
    rows,
  });
  if (request.dryRun) return ok(summary());

  for (const plan of plans) {
    const copied = await copyTranslationArtifacts(deps, plan);
    if (!copied.ok) return copied;
  }

  const written = await deps.globalCatalog.withBatch(async () => {
    for (const plan of plans) {
      const variant: CatalogVariant = {
        fingerprint: plan.row.fingerprint,
        configId: plan.configId,
        descriptor: plan.descriptor,
        finalName: plan.row.finalName,
        description: plan.row.description,
        transcript: plan.source.transcript,
        language: 'pl',
        tags: normalizeTagList(plan.row.tags),
        analyzer: 'translation',
        model: plan.row.translator.model,
        createdAt: plan.createdAt,
        usage: null,
        resolvedOutputLanguage: 'pl',
        resolvedTagLanguage: 'pl',
      };
      const upserted = await deps.globalCatalog.upsertVariant(variant, { outputLanguage: 'pl', tagLanguage: 'pl' });
      if (!upserted.ok) return upserted;
      if (request.select) {
        const selected = await deps.globalCatalog.setSelectedVariant(plan.row.fingerprint, plan.configId);
        if (!selected.ok) return selected;
      }
    }
    return ok(undefined);
  });
  return written.ok ? ok(summary()) : written;
};

const parseTranslationLines = (text: string): ParsedTranslationLine[] => {
  const lines: ParsedTranslationLine[] = [];
  for (const [index, rawLine] of text.split('\n').entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      lines.push({ line: index + 1, row: null, reason: 'invalid_json' });
      continue;
    }
    const parsed = translationImportRowSchema.safeParse(decoded);
    lines.push(parsed.success
      ? { line: index + 1, row: parsed.data, reason: null }
      : { line: index + 1, row: null, reason: 'invalid_row' });
  }
  return lines;
};

const copyTranslationArtifacts = async (
  deps: TranslationImportDeps,
  plan: TranslationImportPlan,
): Promise<Result<void, AppError>> => {
  const file = await deps.globalCatalog.getFile(plan.row.fingerprint);
  if (!file.ok) return file;
  if (file.value === null) {
    return { ok: false, error: appError('not_found', `Catalog file not found: ${plan.row.fingerprint}`) };
  }
  const folder = await deps.globalCatalog.getFolder(file.value.folderId);
  if (!folder.ok) return folder;
  if (folder.value === null) {
    return { ok: false, error: appError('folder_not_found', `Catalog folder not found: ${file.value.folderId}`) };
  }
  const root = await discoverArtifactRoot(deps.fs, folder.value.currentPath);
  if (!root.ok) return root;
  const source = await variantProjectionSource(deps.fs, root.value, plan.source);
  if (!source.ok) return source;
  if (source.value === null) {
    return {
      ok: false,
      error: appError('file_not_found', `Source variant artifacts not found: ${plan.row.fingerprint}/${plan.row.sourceConfigId}`),
    };
  }
  const target = variantArtifactPaths(deps.fs, root.value, plan.row.fingerprint, plan.descriptor);
  return materializeTranslatedVariantArtifacts(deps.fs, source.value, target);
};
