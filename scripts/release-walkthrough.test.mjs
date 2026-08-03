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
  localAnalyzerConfig,
  parseAnalyzerFlag,
  prepareScratchFixtures,
  TOLERATED_SKIPS,
} from './release-walkthrough.mjs';

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
});
