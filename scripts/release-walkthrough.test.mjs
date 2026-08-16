import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  analyzeOutcome,
  blockingSkips,
  BROKEN_PHOTO_MTIME,
  BROKEN_PHOTO_NAME,
  checkOllamaAnalyzer,
  clearLibrarySearch,
  collectionPhotoChipOutcome,
  localAnalyzerConfig,
  parseAnalyzerFlag,
  parseMediaChipCount,
  photoTreeAnalyzeOutcome,
  prepareScratchFixtures,
  searchTermFromAnalyzedFilename,
  TOLERATED_SKIPS,
  treeSelectAnalyzeOutcome,
  TREE_PHOTO_PATH,
} from './release-walkthrough.mjs';

const JPEG_WITH_EOI = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

const sourceWithPhotos = () => {
  const source = mkdtempSync(path.join(tmpdir(), 'avc-walkthrough-fixtures-src-'));
  writeFileSync(path.join(source, 'photo-01.jpg'), JPEG_WITH_EOI);
  writeFileSync(path.join(source, 'photo-01-duplicate.jpg'), JPEG_WITH_EOI);
  writeFileSync(path.join(source, 'photo-02.jpg'), Buffer.concat([JPEG_WITH_EOI, Buffer.from([0x00])]));
  return source;
};

describe('library walkthrough search state', () => {
  it('derives a reliable search term from the analyzed fixture filename', () => {
    expect(searchTermFromAnalyzedFilename('2026-08-16_jezowak-warszawa-oceanografic.mp4')).toBe('jezowak');
  });

  it('clears and reapplies the library search before opening preview', async () => {
    const input = { click: vi.fn(), fill: vi.fn(), press: vi.fn() };

    await clearLibrarySearch(input);

    expect(input.click).toHaveBeenCalledOnce();
    expect(input.fill).toHaveBeenCalledWith('');
    expect(input.press).toHaveBeenCalledWith('Enter');
  });
});

describe('blockingSkips', () => {
  it('excludes the tolerated allowlist from the blocking set', () => {
    const results = [
      { name: 'first-run-wizard', status: 'skipped', note: 'no first-run wizard on this profile' },
      { name: 'library-preview', status: 'skipped', note: 'no library tile to preview' },
      { name: 'analyze', status: 'skipped', note: 'analyzer not configured in this home' },
      { name: 'launch', status: 'ok', note: '' },
    ];

    expect(blockingSkips(results).map((step) => step.name)).toEqual(['analyze']);
  });

  it('reports no blocking skips when every skip is tolerated', () => {
    const results = [...TOLERATED_SKIPS].map((name) => ({ name, status: 'skipped', note: '' }));

    expect(blockingSkips(results)).toEqual([]);
  });
});

describe('analyzeOutcome', () => {
  it('reports failed when the error card is visible, even though the run finished', () => {
    const outcome = analyzeOutcome({
      errorCardVisible: true,
      errorNote: 'Processing Failed\nLocal AI runtime not reachable',
      videoStatus: 'error',
      filename: 'clip.mp4',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toBe('Processing Failed\nLocal AI runtime not reachable');
  });

  it('falls back to a generic note when the error card has no readable text', () => {
    const outcome = analyzeOutcome({ errorCardVisible: true, errorNote: '', videoStatus: 'error', filename: 'clip.mp4' });

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toBe('analysis ended in error');
  });

  it('reports ok and names the analyzed file when the video reached completed with no error card', () => {
    const outcome = analyzeOutcome({ errorCardVisible: false, errorNote: '', videoStatus: 'completed', filename: 'clip.mp4' });

    expect(outcome).toEqual({ status: 'ok', note: 'analysis completed for clip.mp4' });
  });

  it('reports failed for any terminal state that is neither completed nor an error card', () => {
    const outcome = analyzeOutcome({ errorCardVisible: false, errorNote: '', videoStatus: 'frames_extracted', filename: 'clip.mp4' });

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toContain('frames_extracted');
  });
});

describe('treeSelectAnalyzeOutcome', () => {
  it('reports skipped when the whole-tree scope never rendered a root row', () => {
    const outcome = treeSelectAnalyzeOutcome({
      treeVisible: false, rowVisible: false, detailVisible: false, analyzeVisible: false, analyzeDisabled: false, disabledReason: '', path: null,
    });

    expect(outcome).toEqual({ status: 'skipped', note: 'no photos catalogued in this home' });
  });

  it('reports skipped when the tree has folder rows but no photo row to select', () => {
    const outcome = treeSelectAnalyzeOutcome({
      treeVisible: true, rowVisible: false, usableRowVisible: false, detailVisible: false, analyzeVisible: false, analyzeDisabled: false, disabledReason: '', path: null,
    });

    expect(outcome.status).toBe('skipped');
    expect(outcome.note).toContain('no photo rows to select');
  });

  it('reports skipped when every tree photo is already analysed or has a failed proxy', () => {
    const outcome = treeSelectAnalyzeOutcome({
      treeVisible: true, rowVisible: true, usableRowVisible: false, detailVisible: false, analyzeVisible: false, analyzeDisabled: false, disabledReason: '', path: null,
    });

    expect(outcome.status).toBe('skipped');
    expect(outcome.note).toContain('already analysed or has a failed proxy');
  });

  it('reports failed when a tree-selected photo never opened the detail workspace', () => {
    const outcome = treeSelectAnalyzeOutcome({
      treeVisible: true, rowVisible: true, usableRowVisible: true, detailVisible: false, analyzeVisible: false, analyzeDisabled: false, disabledReason: '', path: '/media/a.jpg',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toContain('detail workspace');
  });

  it('reports failed when Analizuj is disabled for a tree-selected photo (the W57 regression)', () => {
    const outcome = treeSelectAnalyzeOutcome({
      treeVisible: true, rowVisible: true, usableRowVisible: true, detailVisible: true, analyzeVisible: true, analyzeDisabled: true, disabledReason: 'analyzer not configured', path: '/media/a.jpg',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toBe('Analizuj is disabled for a tree-selected photo: analyzer not configured (W57 regression)');
  });

  it('reports ok and names the photo path when Analizuj is enabled for a tree-selected photo', () => {
    const outcome = treeSelectAnalyzeOutcome({
      treeVisible: true, rowVisible: true, usableRowVisible: true, detailVisible: true, analyzeVisible: true, analyzeDisabled: false, disabledReason: '', path: '/media/a.jpg',
    });

    expect(outcome).toEqual({ status: 'ok', note: 'tree-selected /media/a.jpg has Analizuj enabled' });
  });
});

describe('photoTreeAnalyzeOutcome', () => {
  it('reports failed when the sidebar job-error alert is visible', () => {
    const outcome = photoTreeAnalyzeOutcome({ errorVisible: true, errorNote: 'Local AI runtime not reachable', badgeVisible: false });

    expect(outcome).toEqual({ status: 'failed', note: 'Local AI runtime not reachable' });
  });

  it('falls back to a generic note when the error alert has no readable text', () => {
    const outcome = photoTreeAnalyzeOutcome({ errorVisible: true, errorNote: '', badgeVisible: false });

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toBe('photo analysis ended in error');
  });

  it('reports ok once the tree-selected row carries the analysed badge with no error alert', () => {
    const outcome = photoTreeAnalyzeOutcome({ errorVisible: false, errorNote: '', badgeVisible: true });

    expect(outcome.status).toBe('ok');
  });

  it('reports failed when the run finished with neither the badge nor an error card', () => {
    const outcome = photoTreeAnalyzeOutcome({ errorVisible: false, errorNote: '', badgeVisible: false });

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toContain('neither');
  });
});

describe('parseMediaChipCount', () => {
  it('parses the count out of "Zdjęcia (3)"', () => {
    expect(parseMediaChipCount('Zdjęcia (3)')).toBe(3);
  });

  it('returns null when the chip carries no measured count', () => {
    expect(parseMediaChipCount('Zdjęcia')).toBeNull();
    expect(parseMediaChipCount(null)).toBeNull();
  });
});

describe('collectionPhotoChipOutcome', () => {
  it('reports failed when the chip rendered no measured count', () => {
    const outcome = collectionPhotoChipOutcome(null);

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toContain('did not render a measured count');
  });

  it('reports failed when the chip still counts zero analyzed photos', () => {
    const outcome = collectionPhotoChipOutcome(0);

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toContain('still reports 0');
  });

  it('reports ok once the chip counts at least one analyzed photo', () => {
    const outcome = collectionPhotoChipOutcome(1);

    expect(outcome).toEqual({ status: 'ok', note: 'Kolekcja Zdjęcia chip shows 1 analyzed photo(s)' });
  });
});

describe('parseAnalyzerFlag', () => {
  it('parses a local:<model> value into a backend and model', () => {
    expect(parseAnalyzerFlag('local:gemma3:4b')).toEqual({ backend: 'local', model: 'gemma3:4b' });
  });

  it('rejects a value with no model after the colon', () => {
    expect(() => parseAnalyzerFlag('local:')).toThrow();
  });

  it('rejects a value with an unsupported backend', () => {
    expect(() => parseAnalyzerFlag('claude:sonnet')).toThrow();
  });
});

describe('localAnalyzerConfig', () => {
  it('drops an analyzer_provider the driven home already had, which outranks the seeded backend', () => {
    const seeded = localAnalyzerConfig({ ui_language: 'pl', analyzer_provider: '{"family":"claude"}' }, 'gemma3:4b');

    expect(seeded).toEqual({
      ui_language: 'pl',
      analyzer_backend: 'local',
      local_model: 'gemma3:4b',
      whisper_mode: 'skip',
    });
  });

  it('overwrites a different local model the home was configured with', () => {
    const seeded = localAnalyzerConfig({ analyzer_backend: 'local', local_model: 'gemma3:27b', whisper_mode: 'local' }, 'gemma3:4b');

    expect(seeded).toEqual({ analyzer_backend: 'local', local_model: 'gemma3:4b', whisper_mode: 'skip' });
  });
});

describe('checkOllamaAnalyzer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails fast with a clear message when ollama is not reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434')));

    await expect(checkOllamaAnalyzer('gemma3:4b')).rejects.toThrow(/system ollama.*reachable/i);
  });

  it('fails fast with a clear message when the model is not installed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: 'llama3:8b' }] }),
    }));

    await expect(checkOllamaAnalyzer('gemma3:4b')).rejects.toThrow(/model not installed/i);
  });

  it('resolves without throwing when the model is installed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: 'gemma3:4b' }] }),
    }));

    await expect(checkOllamaAnalyzer('gemma3:4b')).resolves.toBeUndefined();
  });
});

describe('TOLERATED_SKIPS', () => {
  it('never tolerates a skipped analyze step: release runs must provide an analyzer', () => {
    expect(TOLERATED_SKIPS.has('analyze')).toBe(false);
  });
});

describe('prepareScratchFixtures', () => {
  it('copies the source fixtures into a fresh scratch folder without mutating the original', () => {
    const source = mkdtempSync(path.join(tmpdir(), 'avc-walkthrough-fixtures-src-'));
    writeFileSync(path.join(source, 'clip.mp4'), 'not a real video, just a marker');

    const scratchDir = prepareScratchFixtures(source);

    expect(scratchDir).not.toBe(source);
    expect(existsSync(path.join(scratchDir, 'clip.mp4'))).toBe(true);
    expect(existsSync(path.join(source, BROKEN_PHOTO_NAME))).toBe(false);
  });

  it('plants an unloadable jpg alongside the copied fixtures', () => {
    const source = mkdtempSync(path.join(tmpdir(), 'avc-walkthrough-fixtures-src-'));
    mkdirSync(source, { recursive: true });

    const scratchDir = prepareScratchFixtures(source);
    const brokenPath = path.join(scratchDir, BROKEN_PHOTO_NAME);

    expect(existsSync(brokenPath)).toBe(true);
    const bytes = readFileSync(brokenPath);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes.length).toBeLessThan(64);
  });

  it('plants the broken jpg with an old mtime so it sorts last in a captured-at ordering', () => {
    const source = mkdtempSync(path.join(tmpdir(), 'avc-walkthrough-fixtures-src-'));
    mkdirSync(source, { recursive: true });

    const scratchDir = prepareScratchFixtures(source);
    const brokenPath = path.join(scratchDir, BROKEN_PHOTO_NAME);

    const { mtime } = statSync(brokenPath);
    expect(mtime.getTime()).toBe(BROKEN_PHOTO_MTIME.getTime());
    expect(mtime.getTime()).toBeLessThan(new Date('2001-01-01T00:00:00Z').getTime());
  });

  it('gives every copied photo content the source never had, so a QA home cannot key it back to the source root', () => {
    const source = sourceWithPhotos();

    const first = readFileSync(path.join(prepareScratchFixtures(source), 'photo-01.jpg'));
    const second = readFileSync(path.join(prepareScratchFixtures(source), 'photo-01.jpg'));
    const original = readFileSync(path.join(source, 'photo-01.jpg'));

    expect(first.equals(original)).toBe(false);
    expect(first.subarray(0, original.length).equals(original)).toBe(true);
    expect(first.equals(second)).toBe(false);
  });

  it('keeps the intentional duplicate pair byte-identical to each other', () => {
    const scratchDir = prepareScratchFixtures(sourceWithPhotos());

    const photo = readFileSync(path.join(scratchDir, 'photo-01.jpg'));
    const duplicate = readFileSync(path.join(scratchDir, 'photo-01-duplicate.jpg'));
    const other = readFileSync(path.join(scratchDir, 'photo-02.jpg'));

    expect(photo.equals(duplicate)).toBe(true);
    expect(photo.equals(other)).toBe(false);
  });

  it('plants a photo in a subfolder, whose own fingerprint is what makes the whole-tree scope available', () => {
    const scratchDir = prepareScratchFixtures(sourceWithPhotos());

    const treePhoto = readFileSync(path.join(scratchDir, TREE_PHOTO_PATH));
    const rootPhotos = ['photo-01.jpg', 'photo-01-duplicate.jpg', 'photo-02.jpg']
      .map((name) => readFileSync(path.join(scratchDir, name)));

    expect(rootPhotos.some((photo) => photo.equals(treePhoto))).toBe(false);
  });

  it('leaves the planted broken photo out of the per-run marking, so its proxy still fails', () => {
    const scratchDir = prepareScratchFixtures(sourceWithPhotos());

    expect(readFileSync(path.join(scratchDir, BROKEN_PHOTO_NAME)).length).toBeLessThan(64);
  });
});
