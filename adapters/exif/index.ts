import { readFile } from 'node:fs/promises';
import exifr from 'exifr';

import { appError, ok, type AppError, type ExifSummary, type Result } from '@core/domain/index.js';
import type { ExifPort } from '@core/server/index.js';

export class ExifrExifAdapter implements ExifPort {
  async read(path: string): Promise<Result<ExifSummary | null, AppError>> {
    let buffer: Buffer;
    try {
      buffer = await readFile(path);
    } catch (cause) {
      return { ok: false, error: appError('read_error', `Failed to read file for EXIF: ${path}`, cause) };
    }
    try {
      const parsed: unknown = await exifr.parse(buffer, {
        tiff: true,
        exif: true,
        gps: true,
        translateValues: false,
        reviveValues: false,
      });
      if (!isRecord(parsed)) return ok(null);
      return ok(toExifSummary(parsed));
    } catch {
      return ok(null);
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'number') return value[0];
  return null;
};

const toString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

const dmsToDecimal = (dms: unknown, ref: unknown): number | null => {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const [degrees, minutes, seconds] = dms;
  if (typeof degrees !== 'number' || typeof minutes !== 'number' || typeof seconds !== 'number') return null;
  const magnitude = degrees + minutes / 60 + seconds / 3600;
  return ref === 'S' || ref === 'W' ? -magnitude : magnitude;
};

const gpsInstantFromStamps = (dateStamp: unknown, timeStamp: unknown): string | null => {
  if (typeof dateStamp !== 'string') return null;
  const dateMatch = /^(\d{4}):(\d{2}):(\d{2})$/.exec(dateStamp);
  if (dateMatch === null) return null;
  if (!Array.isArray(timeStamp) || timeStamp.length < 3) return null;
  const [hour, minute, second] = timeStamp;
  if (typeof hour !== 'number' || typeof minute !== 'number' || typeof second !== 'number') return null;
  const [, year, month, day] = dateMatch;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute, Math.trunc(second));
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toExifSummary = (tags: Record<string, unknown>): ExifSummary => ({
  width: toNumber(tags.ExifImageWidth ?? tags.PixelXDimension ?? tags.ImageWidth),
  height: toNumber(tags.ExifImageHeight ?? tags.PixelYDimension ?? tags.ImageHeight),
  orientation: toNumber(tags.Orientation),
  cameraMake: toString(tags.Make),
  cameraModel: toString(tags.Model),
  lens: toString(tags.LensModel),
  iso: toNumber(tags.ISO ?? tags.ISOSpeedRatings),
  fNumber: toNumber(tags.FNumber),
  exposureTime: toNumber(tags.ExposureTime),
  rating: toNumber(tags.Rating),
  dateTimeOriginal: toString(tags.DateTimeOriginal),
  offsetTimeOriginal: toString(tags.OffsetTimeOriginal),
  gpsInstant: gpsInstantFromStamps(tags.GPSDateStamp, tags.GPSTimeStamp),
  gpsLat: dmsToDecimal(tags.GPSLatitude, tags.GPSLatitudeRef),
  gpsLon: dmsToDecimal(tags.GPSLongitude, tags.GPSLongitudeRef),
});
