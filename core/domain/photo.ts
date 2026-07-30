import { z } from 'zod';

export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'arw', 'dng'] as const;
export type PhotoExtension = (typeof PHOTO_EXTENSIONS)[number];
export const photoExtensionSchema = z.enum(PHOTO_EXTENSIONS);

export const isSupportedPhotoExtension = (fileName: string): boolean => {
  const lastDot = fileName.lastIndexOf('.');
  const extension = lastDot <= 0 ? '' : fileName.slice(lastDot + 1).toLowerCase();
  return PHOTO_EXTENSIONS.some((candidate) => candidate === extension);
};

export const PHOTO_FINGERPRINT_PREFIX = 'ph_';
export const photoFingerprintSchema = z.string().regex(/^ph_[0-9a-f]{16}$/);

export const photoFingerprintFromSha256 = (hexDigest: string): string =>
  `${PHOTO_FINGERPRINT_PREFIX}${hexDigest.slice(0, 16)}`;

export const CAPTURED_AT_SOURCES = ['exif_offset', 'exif_gps_time', 'exif_local_assumed', 'file_mtime'] as const;
export type CapturedAtSource = (typeof CAPTURED_AT_SOURCES)[number];

export interface ExifSummary {
  width: number | null;
  height: number | null;
  orientation: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  iso: number | null;
  fNumber: number | null;
  exposureTime: number | null;
  rating: number | null;
  dateTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
  gpsInstant: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
}

export interface CapturedAt {
  capturedAt: string;
  source: CapturedAtSource;
}

const EXIF_DATETIME_PATTERN = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})$/;

const parseExifOffsetMinutes = (offset: string): number | null => {
  const match = OFFSET_PATTERN.exec(offset);
  if (match === null) return null;
  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
};

const parseWallClockParts = (value: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null => {
  const match = EXIF_DATETIME_PATTERN.exec(value);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
};

const utcIsoFromWallClockWithOffsetMinutes = (value: string, offsetMinutes: number): string | null => {
  const parts = parseWallClockParts(value);
  if (parts === null) return null;
  const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - offsetMinutes * 60_000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

export const deriveCapturedAt = (
  exif: ExifSummary | null,
  fileMtimeMs: number,
  hostUtcOffsetMinutes: (atLocalWallClock: string) => number,
): CapturedAt => {
  if (exif !== null && exif.dateTimeOriginal !== null && exif.offsetTimeOriginal !== null) {
    const offsetMinutes = parseExifOffsetMinutes(exif.offsetTimeOriginal);
    if (offsetMinutes !== null) {
      const iso = utcIsoFromWallClockWithOffsetMinutes(exif.dateTimeOriginal, offsetMinutes);
      if (iso !== null) return { capturedAt: iso, source: 'exif_offset' };
    }
  }
  if (exif !== null && exif.gpsInstant !== null) {
    const date = new Date(exif.gpsInstant);
    if (!Number.isNaN(date.getTime())) return { capturedAt: date.toISOString(), source: 'exif_gps_time' };
  }
  if (exif !== null && exif.dateTimeOriginal !== null) {
    const offsetMinutes = hostUtcOffsetMinutes(exif.dateTimeOriginal);
    const iso = utcIsoFromWallClockWithOffsetMinutes(exif.dateTimeOriginal, offsetMinutes);
    if (iso !== null) return { capturedAt: iso, source: 'exif_local_assumed' };
  }
  return { capturedAt: new Date(fileMtimeMs).toISOString(), source: 'file_mtime' };
};
