import { describe, expect, it } from 'vitest';

import {
  deriveCapturedAt,
  isSupportedPhotoExtension,
  photoFingerprintFromSha256,
  photoFingerprintSchema,
  type ExifSummary,
} from './photo.js';

const emptyExif: ExifSummary = {
  width: null,
  height: null,
  orientation: null,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  iso: null,
  fNumber: null,
  exposureTime: null,
  rating: null,
  dateTimeOriginal: null,
  offsetTimeOriginal: null,
  gpsInstant: null,
  gpsLat: null,
  gpsLon: null,
};

describe('isSupportedPhotoExtension', () => {
  it('accepts every declared extension case-insensitively', () => {
    expect(isSupportedPhotoExtension('a.JPG')).toBe(true);
    expect(isSupportedPhotoExtension('a.jpeg')).toBe(true);
    expect(isSupportedPhotoExtension('a.PNG')).toBe(true);
    expect(isSupportedPhotoExtension('a.heic')).toBe(true);
    expect(isSupportedPhotoExtension('a.ARW')).toBe(true);
    expect(isSupportedPhotoExtension('a.dng')).toBe(true);
  });

  it('rejects unsupported extensions and dotfiles without an extension', () => {
    expect(isSupportedPhotoExtension('a.txt')).toBe(false);
    expect(isSupportedPhotoExtension('.hidden')).toBe(false);
    expect(isSupportedPhotoExtension('noext')).toBe(false);
  });
});

describe('photoFingerprintFromSha256', () => {
  it('prefixes ph_ and truncates to the first 16 hex characters', () => {
    const digest = 'a'.repeat(64);
    const fingerprint = photoFingerprintFromSha256(digest);
    expect(fingerprint).toBe(`ph_${'a'.repeat(16)}`);
    expect(photoFingerprintSchema.safeParse(fingerprint).success).toBe(true);
  });
});

describe('deriveCapturedAt', () => {
  const offsetProvider = () => 60;

  it('rung 1: dateTimeOriginal + offsetTimeOriginal converts to UTC', () => {
    const exif: ExifSummary = { ...emptyExif, dateTimeOriginal: '2026:01:02 10:00:00', offsetTimeOriginal: '+02:00' };
    const result = deriveCapturedAt(exif, 0, offsetProvider);
    expect(result).toEqual({ capturedAt: '2026-01-02T08:00:00.000Z', source: 'exif_offset' });
  });

  it('rung 2: falls back to gpsInstant when no offset is present', () => {
    const exif: ExifSummary = { ...emptyExif, dateTimeOriginal: '2026:01:02 10:00:00', gpsInstant: '2026-01-02T08:30:00.000Z' };
    const result = deriveCapturedAt(exif, 0, offsetProvider);
    expect(result).toEqual({ capturedAt: '2026-01-02T08:30:00.000Z', source: 'exif_gps_time' });
  });

  it('rung 3: falls back to the host-assumed local time via the injected offset', () => {
    const exif: ExifSummary = { ...emptyExif, dateTimeOriginal: '2026:01:02 10:00:00' };
    const result = deriveCapturedAt(exif, 0, () => 60);
    expect(result).toEqual({ capturedAt: '2026-01-02T09:00:00.000Z', source: 'exif_local_assumed' });
  });

  it('rung 3 receives the wall-clock string so DST can be resolved by the caller', () => {
    const exif: ExifSummary = { ...emptyExif, dateTimeOriginal: '2026:07:02 10:00:00' };
    let receivedWallClock = '';
    deriveCapturedAt(exif, 0, (wallClock) => {
      receivedWallClock = wallClock;
      return 120;
    });
    expect(receivedWallClock).toBe('2026:07:02 10:00:00');
  });

  it('rung 4: falls back to file mtime when there is no usable EXIF at all', () => {
    const result = deriveCapturedAt(null, Date.UTC(2026, 0, 1, 0, 0, 0), offsetProvider);
    expect(result).toEqual({ capturedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString(), source: 'file_mtime' });
  });

  it('falls through to file_mtime when dateTimeOriginal is unparseable', () => {
    const exif: ExifSummary = { ...emptyExif, dateTimeOriginal: 'not-a-date' };
    const result = deriveCapturedAt(exif, Date.UTC(2026, 0, 1), offsetProvider);
    expect(result).toEqual({ capturedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(), source: 'file_mtime' });
  });

  it('falls through past a malformed offset to the local-assumed rung', () => {
    const exif: ExifSummary = { ...emptyExif, dateTimeOriginal: '2026:01:02 10:00:00', offsetTimeOriginal: 'bogus' };
    const result = deriveCapturedAt(exif, 0, () => 0);
    expect(result).toEqual({ capturedAt: '2026-01-02T10:00:00.000Z', source: 'exif_local_assumed' });
  });
});
