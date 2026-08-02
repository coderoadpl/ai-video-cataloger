import { describe, expect, it } from 'vitest';

import {
  accuracyMForLibraConfidence,
  libraDescriptionEntrySchema,
  libraFaceEntrySchema,
  libraGeoEntrySchema,
  libraManifestEntrySchema,
  mapLibraGeoIntervalKind,
  mapLibraQuality,
  mapLibraScene,
  normalizeLibraPath,
  parseLibraNdjson,
  translateLibraFaceObsId,
} from './photo-libra-import.js';

describe('parseLibraNdjson', () => {
  it('parses valid lines and counts invalid JSON and schema-rejected lines separately', () => {
    const text = [
      '{"md5":"' + 'a'.repeat(32) + '","descPl":"Zachod slonca","tags":["sky"],"scene":"landscape","quality":"ok"}',
      'not json',
      '{"md5":"short","descPl":"x","tags":[],"scene":"x","quality":"x"}',
      '',
      '   ',
    ].join('\n');
    const result = parseLibraNdjson(text, libraDescriptionEntrySchema);
    expect(result.values).toHaveLength(1);
    expect(result.invalidLines).toBe(2);
    expect(result.totalLines).toBe(3);
  });
});

describe('normalizeLibraPath', () => {
  it('strips leading slashes and NFC-normalizes', () => {
    expect(normalizeLibraPath('/photos/a.jpg')).toBe('photos/a.jpg');
    expect(normalizeLibraPath('photos/a.jpg')).toBe('photos/a.jpg');
  });
});

describe('translateLibraFaceObsId', () => {
  it('translates the libra md5:face:N scheme into the app fingerprint:face:1:N scheme', () => {
    expect(translateLibraFaceObsId('ph_0123456789abcdef', 'abcabcabcabcabcabcabcabcabcabcab:face:3')).toBe(
      'ph_0123456789abcdef:face:1:3',
    );
  });

  it('returns null for a malformed libra obsId', () => {
    expect(translateLibraFaceObsId('ph_0123456789abcdef', 'abcabcabcabcabcabcabcabcabcabcab:face:0')).toBeNull();
    expect(translateLibraFaceObsId('ph_0123456789abcdef', 'not-an-obs-id')).toBeNull();
  });
});

describe('mapLibraScene', () => {
  it('translates the libra scene vocabulary onto the closed PHOTO_SCENES union', () => {
    expect(mapLibraScene('portrait')).toBe('people');
    expect(mapLibraScene('group')).toBe('people');
    expect(mapLibraScene('city')).toBe('urban');
    expect(mapLibraScene('interior')).toBe('indoor');
    expect(mapLibraScene('detail')).toBe('object');
  });

  it('falls back to other for an unmapped value instead of guessing', () => {
    expect(mapLibraScene('spaceship')).toBe('other');
  });
});

describe('mapLibraQuality', () => {
  it('translates the libra quality vocabulary onto the closed PHOTO_QUALITIES union', () => {
    expect(mapLibraQuality('ok')).toBe('good');
    expect(mapLibraQuality('blurry')).toBe('blurry');
    expect(mapLibraQuality('dark')).toBe('dark');
    expect(mapLibraQuality('junk')).toBe('other');
  });

  it('falls back to other for an unmapped value instead of guessing', () => {
    expect(mapLibraQuality('mystery')).toBe('other');
  });
});

describe('mapLibraGeoIntervalKind', () => {
  it('accepts only the known timeline interval kinds', () => {
    expect(mapLibraGeoIntervalKind('visit')).toBe('visit');
    expect(mapLibraGeoIntervalKind('path')).toBe('path');
    expect(mapLibraGeoIntervalKind('activity')).toBe('activity');
  });

  it('rejects exif and null sources rather than fabricating a camera provenance claim', () => {
    expect(mapLibraGeoIntervalKind('exif')).toBeNull();
    expect(mapLibraGeoIntervalKind(null)).toBeNull();
  });
});

describe('accuracyMForLibraConfidence', () => {
  it('maps confidence buckets to a declared accuracy radius', () => {
    expect(accuracyMForLibraConfidence('high')).toBe(50);
    expect(accuracyMForLibraConfidence('medium')).toBe(150);
    expect(accuracyMForLibraConfidence('low')).toBe(500);
  });

  it('returns null for missing or unrecognised confidence', () => {
    expect(accuracyMForLibraConfidence(null)).toBeNull();
    expect(accuracyMForLibraConfidence(undefined)).toBeNull();
    expect(accuracyMForLibraConfidence('unsure')).toBeNull();
  });
});

describe('schemas', () => {
  it('parses a real-shaped manifest entry', () => {
    const parsed = libraManifestEntrySchema.safeParse({
      path: 'photos/Karta SD/DCIM/10191109/_AD_0052.JPG',
      size: 2457600,
      mtime: 1575825304000,
      md5: 'fa459553a22acb12718b839e7ef3386c',
    });
    expect(parsed.success).toBe(true);
  });

  it('parses a real-shaped face entry with no detected face', () => {
    const parsed = libraFaceEntrySchema.safeParse({ md5: '0001b1fd527430a3a84cef6eb25b9ee3', obsId: null });
    expect(parsed.success).toBe(true);
  });

  it('parses a real-shaped face entry with a detection', () => {
    const parsed = libraFaceEntrySchema.safeParse({
      md5: '0006cca92be7e47ff264e3d41e4974de',
      obsId: '0006cca92be7e47ff264e3d41e4974de:face:1',
      bbox: { x: 632.9, y: 173.5, width: 248.7, height: 355.9 },
      score: 0.94,
      embedding: Array.from({ length: 128 }, (_, index) => index / 128),
    });
    expect(parsed.success).toBe(true);
  });

  it('parses a real-shaped geo entry', () => {
    const parsed = libraGeoEntrySchema.safeParse({
      path: 'photos/Karta SD/DCIM/10191109/_AD_0052.JPG',
      lat: 49.844017,
      lon: 24.026212,
      placeId: 'ChIJiWq8-XLdOkcRH8_-tOw_ePk',
      semanticType: 'Unknown',
      source: 'visit',
      confidence: 'high',
    });
    expect(parsed.success).toBe(true);
  });

  it('parses a real-shaped geo entry libra could not resolve to a location', () => {
    const parsed = libraGeoEntrySchema.safeParse({
      path: 'photos/Mac Codete Backup/Kielce 01.2022/_AD_9585.ARW',
      lat: null,
      lon: null,
      placeId: null,
      semanticType: null,
      source: null,
      confidence: null,
    });
    expect(parsed.success).toBe(true);
  });
});
