import { describe, expect, it } from 'vitest';

import {
  photosForgetHuman,
  photosGpsBackfillHuman,
  photosProcessHuman,
  photosGridThumbsHuman,
  photosProxiesHuman,
  photosSearchHuman,
  photosStatusHuman,
  photosVariantNdjsonRow,
  photosVariantsListHuman,
} from './photos-human.js';

describe('photosStatusHuman', () => {
  it('formats an overall status', () => {
    const text = photosStatusHuman({
      media: 'photo',
      root: null,
      counts: { photos: 10, paths: 12, exifRead: 8, exifFailed: 2, missing: 1, duplicates: 2, proxied: 7, proxyFailed: 1, analysed: 5, facesIndexed: 0 },
    });
    expect(text).toBe(
      'Scope: all photos\n'
      + 'Photos: 10 (12 paths, 2 duplicated)\n'
      + 'EXIF read: 8 / failed: 2\n'
      + 'Proxies: 7 generated, 1 failed\n'
      + 'Analysed: 5\n'
      + 'Faces indexed: 0\n'
      + 'Missing: 1',
    );
  });

  it('formats a root-scoped status', () => {
    const text = photosStatusHuman({
      media: 'photo',
      root: '/media/photos',
      counts: { photos: 1, paths: 1, exifRead: 0, exifFailed: 1, missing: 0, duplicates: 0, proxied: 0, proxyFailed: 0, analysed: 0, facesIndexed: 0 },
    });
    expect(text).toContain('Scope: /media/photos');
  });
});

describe('photosForgetHuman', () => {
  it('formats a forget summary', () => {
    const text = photosForgetHuman({
      media: 'photo',
      root: '/media/photos',
      pathsRemoved: 3,
      photosDeleted: 2,
      photosRepointed: 1,
      artifactPaths: ['/home/.ai-video-cataloger/photo-artifacts/proxies/ph_1.jpg'],
    });
    expect(text).toBe('Forgot /media/photos: 3 paths removed, 2 photos deleted, 1 photos re-pointed');
  });
});

describe('photosProxiesHuman', () => {
  it('formats a proxies summary', () => {
    const text = photosProxiesHuman({
      media: 'photo',
      root: '/media/photos',
      force: false,
      candidates: 163,
      generated: 120,
      skippedExisting: 40,
      failed: 3,
      thumbFailed: 0,
      gridFailed: 1,
    });
    expect(text).toBe('Proxies: 120 generated, 3 failed, 40 already present (163 candidates), grid: 1 failed');
  });
});

describe('photosGridThumbsHuman', () => {
  it('formats a grid thumbnails summary', () => {
    const text = photosGridThumbsHuman({
      media: 'photo',
      force: false,
      candidates: 163,
      generated: 120,
      skipped: 40,
      failed: 3,
    });
    expect(text).toBe('Grid thumbnails: 120 generated, 3 failed, 40 already present (163 candidates)');
  });
});

describe('photosProcessHuman', () => {
  it('formats a process summary', () => {
    const text = photosProcessHuman({
      media: 'photo',
      root: '/media/photos',
      force: false,
      configId: 'cfg_ab12cd34ef56',
      batchSize: 12,
      candidates: 163,
      analysed: 120,
      failed: 3,
      skippedExisting: 40,
      splitRetries: 2,
    });
    expect(text).toBe('Analysed: 120 of 163 candidates, 3 failed, 40 already analysed (cfg_ab12cd34ef56, batch 12)');
  });
});

describe('photosGpsBackfillHuman', () => {
  it('formats a backfill summary including the assumed-timezone widened count', () => {
    const text = photosGpsBackfillHuman({
      media: 'photo',
      timelinePath: '/timeline.json',
      dryRun: false,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      timeline: { entries: 1, entriesSkipped: 0, entriesIgnored: 0, intervals: 1, firstStart: null, lastEnd: null },
      photosTotal: 10,
      photosConsidered: 8,
      matched: { visit: 5, activity: 1, path: 0 },
      matchedWithinTolerance: 1,
      assumedWidened: 2,
      written: 6,
      unchanged: 0,
      unmatched: 2,
      skipped: { cameraGps: 1, manualGps: 1, noCapturedAt: 0 },
      accuracy: { buckets: [], medianM: 50, p90M: 200 },
      places: { datasetId: 'geonames', resolved: 4, unresolved: 1, skippedNoDataset: 0 },
      elapsedMs: 100,
    });
    expect(text).toBe([
      'Photo GPS backfill:',
      'Photos considered: 8 of 10 (camera-protected: 1, manual-protected: 1)',
      'Matched: visit=5 activity=1 path=0 unmatched=2',
      'Assumed-timezone widened matches: 2',
      'Accuracy median=50m p90=200m',
      'Written: 6, unchanged: 0',
      'Skipped: noCapturedAt=0',
      'Places: resolved=4 unresolved=1 skippedNoDataset=0',
    ].join('\n'));
  });
});

describe('photosSearchHuman', () => {
  it('renders fileName — snippet (tags) lines and a count', () => {
    const text = photosSearchHuman({
      media: 'photo',
      query: 'bicycle',
      limit: 50,
      offset: 0,
      count: 1,
      results: [{
        fingerprint: 'ph_0000000000000001',
        fileName: 'a.jpg',
        currentPath: '/photos/a.jpg',
        ext: 'jpg',
        capturedAt: '2026-01-01T00:00:00.000Z',
        description: 'a red bicycle',
        snippet: 'a red <mark>bicycle</mark>',
        tags: ['bicycle', 'brick-wall'],
        variantCount: 1,
        thumbState: 'done',
        proxyState: 'done',
        missingAt: null,
        thumbPath: '/artifacts/thumbs/ph_0000000000000001.jpg',
        gridThumbPath: '/artifacts/thumbs/ph_0000000000000001.grid.jpg',
        proxyPath: '/artifacts/proxies/ph_0000000000000001.jpg',
      }],
    });
    expect(text).toBe('a.jpg — a red bicycle (bicycle, brick-wall)\n1 result(s)');
  });

  it('reports no results', () => {
    const text = photosSearchHuman({ media: 'photo', query: 'nope', limit: 50, offset: 0, count: 0, results: [] });
    expect(text).toBe('No results found');
  });
});

describe('photosVariantsListHuman and photosVariantNdjsonRow', () => {
  const variant = {
    configId: 'cfg_ab12cd34ef56',
    label: 'harness · claude-code · en',
    description: 'a red bicycle',
    scene: 'urban',
    quality: 'good',
    language: 'en',
    analyzer: 'harness',
    model: 'claude-code',
    batchSize: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    tags: ['bicycle'],
    selected: true,
    explicit: false,
  };

  it('formats a variants table with a selected marker and an explicit/resolved column', () => {
    const text = photosVariantsListHuman({
      media: 'photo',
      fingerprint: 'ph_0000000000000001',
      selectedConfigId: 'cfg_ab12cd34ef56',
      variants: [variant],
    });
    expect(text).toBe(
      'SELECTED\tCONFIG\tLABEL\tEXPLICIT\tCREATED\n'
      + '*\tcfg_ab12cd34ef56\tharness · claude-code · en\tresolved\t2026-01-01T00:00:00.000Z',
    );
  });

  it('reports no variants', () => {
    const text = photosVariantsListHuman({ media: 'photo', fingerprint: 'ph_1', selectedConfigId: null, variants: [] });
    expect(text).toBe('No analysis variants found');
  });

  it('projects the NDJSON row fields', () => {
    expect(photosVariantNdjsonRow(variant)).toEqual({
      configId: 'cfg_ab12cd34ef56',
      label: 'harness · claude-code · en',
      selected: true,
      explicit: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      analyzer: 'harness',
      model: 'claude-code',
    });
  });
});
