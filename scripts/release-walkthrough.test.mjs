import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockingSkips, BROKEN_PHOTO_MTIME, BROKEN_PHOTO_NAME, prepareScratchFixtures, TOLERATED_SKIPS } from './release-walkthrough.mjs';

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
