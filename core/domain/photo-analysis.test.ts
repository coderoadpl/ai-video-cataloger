import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PHOTO_BATCH_SIZE,
  PHOTO_BATCH_CLAMPS,
  buildPhotoAnalyzerPrompt,
  clampPhotoBatchSize,
  parsePhotoBatchResponse,
  splitPhotoBatch,
  type PhotoFrameMode,
} from './index.js';

const element = (index: number) => ({
  index,
  description: `photo ${String(index)}`,
  tags: ['tag-one'],
  scene: 'people',
  quality: 'good',
});

describe('clampPhotoBatchSize', () => {
  it('defaults, clamps above the family maximum, and floors below one', () => {
    expect(clampPhotoBatchSize('api', null)).toBe(DEFAULT_PHOTO_BATCH_SIZE);
    expect(clampPhotoBatchSize('api', 100)).toBe(PHOTO_BATCH_CLAMPS.api);
    expect(clampPhotoBatchSize('api', 0)).toBe(1);
    expect(clampPhotoBatchSize('api', -5)).toBe(1);
    expect(clampPhotoBatchSize('local', null)).toBe(PHOTO_BATCH_CLAMPS.local);
    expect(clampPhotoBatchSize('local', 12)).toBe(4);
  });
});

describe('splitPhotoBatch', () => {
  it('halves items and returns null for a single item', () => {
    expect(splitPhotoBatch([1, 2, 3, 4])).toEqual([[1, 2], [3, 4]]);
    expect(splitPhotoBatch([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(splitPhotoBatch([1])).toBeNull();
    expect(splitPhotoBatch([])).toBeNull();
  });
});

describe('buildPhotoAnalyzerPrompt', () => {
  const items = [
    { index: 1, fileName: 'a.jpg', proxyPath: '/tmp/a.jpg' },
    { index: 2, fileName: 'b.jpg', proxyPath: '/tmp/b.jpg' },
  ];

  it('numbers every photo and demands a JSON array for attached images', () => {
    const prompt = buildPhotoAnalyzerPrompt({ items, frameMode: 'attached-images', outputLanguage: 'auto', tagLanguage: 'auto' });
    expect(prompt).toContain('1. a.jpg');
    expect(prompt).toContain('2. b.jpg');
    expect(prompt).toContain('JSON array');
  });

  it('numbers by proxy path for dir-access and includes file:// for file-url', () => {
    const dirAccess = buildPhotoAnalyzerPrompt({ items, frameMode: 'dir-access', outputLanguage: 'auto', tagLanguage: 'auto' });
    expect(dirAccess).toContain('1. /tmp/a.jpg');
    const fileUrl = buildPhotoAnalyzerPrompt({ items, frameMode: 'file-url', outputLanguage: 'auto', tagLanguage: 'auto' });
    expect(fileUrl).toContain('1. file:///tmp/a.jpg');
  });

  it('includes the language clause for both output and tag languages', () => {
    const prompt = buildPhotoAnalyzerPrompt({ items, frameMode: 'attached-images', outputLanguage: 'pl', tagLanguage: 'en' });
    expect(prompt).toContain('Polish');
    expect(prompt).toContain('English');
  });

  const familyFrameModes: Array<{ family: string; frameMode: PhotoFrameMode }> = [
    { family: 'local/ollama', frameMode: 'attached-images' },
    { family: 'api', frameMode: 'attached-images' },
    { family: 'harness/claude-cli', frameMode: 'dir-access' },
    { family: 'gemini-native', frameMode: 'attached-images' },
  ];

  it.each(familyFrameModes)('$family resolves auto to the configured Polish UI language', ({ frameMode }) => {
    const prompt = buildPhotoAnalyzerPrompt({
      items,
      frameMode,
      outputLanguage: 'auto',
      tagLanguage: 'auto',
      uiLanguage: 'pl',
    });

    expect(prompt).toContain('Write every DESCRIPTION in Polish.');
    expect(prompt).toContain('Write every TAG in Polish');
  });

  it('leaves explicit English unchanged when the UI language is Polish', () => {
    const prompt = buildPhotoAnalyzerPrompt({
      items,
      frameMode: 'attached-images',
      outputLanguage: 'en',
      tagLanguage: 'en',
      uiLanguage: 'pl',
    });

    expect(prompt).toContain('Write every DESCRIPTION in English.');
    expect(prompt).toContain('Write every TAG in English');
    expect(prompt).not.toContain('in Polish');
  });

  it('falls back to English when the UI language is missing', () => {
    const prompt = buildPhotoAnalyzerPrompt({ items, frameMode: 'attached-images', outputLanguage: 'auto', tagLanguage: 'auto' });

    expect(prompt).toContain('Write every DESCRIPTION in English.');
    expect(prompt).toContain('Write every TAG in English');
  });
});

describe('parsePhotoBatchResponse', () => {
  it('parses a fenced JSON array', () => {
    const raw = '```json\n' + JSON.stringify([element(1), element(2)]) + '\n```';
    const result = parsePhotoBatchResponse(raw, 2);
    expect(result.ok).toBe(true);
  });

  it('extracts from the first [ to the last ]', () => {
    const raw = `Here you go:\n${JSON.stringify([element(1)])}\nThanks!`;
    const result = parsePhotoBatchResponse(raw, 1);
    expect(result.ok).toBe(true);
  });

  it('rejects a duplicate index', () => {
    const raw = JSON.stringify([element(1), { ...element(2), index: 1 }]);
    const result = parsePhotoBatchResponse(raw, 2);
    expect(result.ok).toBe(false);
  });

  it('rejects a missing index (count mismatch)', () => {
    const raw = JSON.stringify([element(1)]);
    const result = parsePhotoBatchResponse(raw, 2);
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range index', () => {
    const raw = JSON.stringify([element(1), { ...element(2), index: 5 }]);
    const result = parsePhotoBatchResponse(raw, 2);
    expect(result.ok).toBe(false);
  });

  it('coerces an unknown scene or quality to other', () => {
    const raw = JSON.stringify([{ ...element(1), scene: 'spaceship', quality: 'mystery' }]);
    const result = parsePhotoBatchResponse(raw, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.scene).toBe('other');
      expect(result.value[0]?.quality).toBe('other');
    }
  });

  it('rejects an empty description', () => {
    const raw = JSON.stringify([{ ...element(1), description: '' }]);
    const result = parsePhotoBatchResponse(raw, 1);
    expect(result.ok).toBe(false);
  });

  it('rejects non-JSON', () => {
    const result = parsePhotoBatchResponse('not json at all', 1);
    expect(result.ok).toBe(false);
  });
});
