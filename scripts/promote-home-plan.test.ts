import { describe, expect, it } from 'vitest';

import { buildPromotionPlan, describeBlockReason, describePlan, type HomeSnapshot } from './promote-home-plan.js';

const emptyDb = { exists: false, schemaVersion: 0 } as const;

const home = (overrides: Partial<HomeSnapshot> = {}): HomeSnapshot => ({
  homeDirectory: '/home/target',
  catalogDirectoryExists: false,
  catalogDb: emptyDb,
  photosDb: emptyDb,
  promotedMarker: null,
  catalogEntries: [],
  counts: { folders: 0, files: 0, analyses: 0, photos: 0 },
  ...overrides,
});

const inputDefaults = {
  sourceCatalogFingerprint: '100:1000',
  supportedGlobalCatalogSchemaVersion: 12,
  supportedPhotosSchemaVersion: 2,
  backupDirectoryFor: (targetHomeDirectory: string) => `${targetHomeDirectory}/.ai-video-cataloger.backup-fixed`,
};

describe('buildPromotionPlan', () => {
  it('refuses when the source has no catalog.db', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({ homeDirectory: '/home/source' }),
      target: home(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toEqual({ kind: 'source_catalog_missing', sourceHomeDirectory: '/home/source' });
    expect(describeBlockReason(result.reason)).toContain('nothing to promote');
  });

  it('refuses when the source catalog schema is newer than supported', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({ homeDirectory: '/home/source', catalogDb: { exists: true, schemaVersion: 99 } }),
      target: home(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toEqual({ kind: 'source_schema_too_new', db: 'catalog', found: 99, supported: 12 });
    expect(describeBlockReason(result.reason)).toContain('newer than the supported version');
  });

  it('refuses when the source photos schema is newer than supported', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({
        homeDirectory: '/home/source',
        catalogDb: { exists: true, schemaVersion: 5 },
        photosDb: { exists: true, schemaVersion: 99 },
      }),
      target: home(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toEqual({ kind: 'source_schema_too_new', db: 'photos', found: 99, supported: 2 });
  });

  it('refuses when both source and target have a photos.db', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({
        homeDirectory: '/home/source',
        catalogDb: { exists: true, schemaVersion: 5 },
        photosDb: { exists: true, schemaVersion: 2 },
      }),
      target: home({ photosDb: { exists: true, schemaVersion: 2 } }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toEqual({ kind: 'photos_conflict' });
    expect(describeBlockReason(result.reason)).toContain('out of scope');
  });

  it('refuses to re-promote an identical already-promoted source', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({ homeDirectory: '/home/source', catalogDb: { exists: true, schemaVersion: 5 } }),
      target: home({
        promotedMarker: {
          sourceHomeDirectory: '/home/source',
          sourceCatalogFingerprint: '100:1000',
          promotedAt: '2026-08-01T00:00:00.000Z',
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toEqual({ kind: 'already_promoted', promotedAt: '2026-08-01T00:00:00.000Z' });
  });

  it('allows re-promoting a source that changed since the last promotion', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({ homeDirectory: '/home/source', catalogDb: { exists: true, schemaVersion: 5 } }),
      target: home({
        catalogDirectoryExists: true,
        promotedMarker: {
          sourceHomeDirectory: '/home/source',
          sourceCatalogFingerprint: '999:9999',
          promotedAt: '2026-08-01T00:00:00.000Z',
        },
      }),
    });

    expect(result.ok).toBe(true);
  });

  it('carries the target photos.db when the source has none', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({ homeDirectory: '/home/source', catalogDb: { exists: true, schemaVersion: 5 } }),
      target: home({ catalogDirectoryExists: true, photosDb: { exists: true, schemaVersion: 2 } }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.photosAction).toBe('carry-target');
    expect(result.plan.backupDirectory).toBe('/home/target/.ai-video-cataloger.backup-fixed');
  });

  it('keeps the source photos.db when the target has none', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({
        homeDirectory: '/home/source',
        catalogDb: { exists: true, schemaVersion: 5 },
        photosDb: { exists: true, schemaVersion: 2 },
      }),
      target: home(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.photosAction).toBe('keep-source');
  });

  it('skips the backup when the target has no existing catalog home', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({ homeDirectory: '/home/source', catalogDb: { exists: true, schemaVersion: 5 } }),
      target: home({ catalogDirectoryExists: false }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.backupDirectory).toBeNull();
    expect(describePlan(result.plan)).toContain('nothing to back up');
  });

  it('preserves the target entries the source does not provide and names the ones it overwrites', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({
        homeDirectory: '/home/source',
        catalogDb: { exists: true, schemaVersion: 5 },
        catalogEntries: ['catalog.db', 'config.json', 'faces', 'models'],
      }),
      target: home({
        catalogDirectoryExists: true,
        photosDb: { exists: true, schemaVersion: 2 },
        catalogEntries: [
          'catalog.db',
          'config.json',
          'credentials.json',
          'models',
          'onboarding.json',
          'photo-artifacts',
          'photos.db',
          'promoted-from.json',
        ],
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.carriedTargetEntries).toEqual(['credentials.json', 'onboarding.json', 'photo-artifacts']);
    expect(result.plan.replacedTargetEntries).toEqual(['catalog.db', 'config.json', 'models']);
    const description = describePlan(result.plan);
    expect(description).toContain('kept from the target: credentials.json, onboarding.json, photo-artifacts');
    expect(description).toContain('overwritten by the source: catalog.db, config.json, models');
  });

  it('carries nothing back when there is no existing target catalog home', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({
        homeDirectory: '/home/source',
        catalogDb: { exists: true, schemaVersion: 5 },
        catalogEntries: ['catalog.db'],
      }),
      target: home({ catalogEntries: ['credentials.json'] }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.carriedTargetEntries).toEqual([]);
    expect(result.plan.replacedTargetEntries).toEqual([]);
  });

  it('describes a full plan for a human to read before confirming', () => {
    const result = buildPromotionPlan({
      ...inputDefaults,
      source: home({
        homeDirectory: '/home/source',
        catalogDb: { exists: true, schemaVersion: 5 },
        counts: { folders: 3, files: 40, analyses: 40, photos: 12 },
      }),
      target: home({ catalogDirectoryExists: true, photosDb: { exists: true, schemaVersion: 2 } }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const description = describePlan(result.plan);
    expect(description).toContain('source: /home/source/.ai-video-cataloger');
    expect(description).toContain('target: /home/target/.ai-video-cataloger');
    expect(description).toContain('carried over verbatim');
    expect(description).toContain('folders=3 files=40 analyses=40 photos=12');
  });
});
