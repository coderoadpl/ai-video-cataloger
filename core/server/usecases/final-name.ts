import { ok, transliterateLatinToAscii, type AppError, type Result } from '@core/domain/index.js';

import type { FileSystemPort } from '../ports.js';

export const normalizeKebabSlug = (value: string): string => {
  const slug = transliterateLatinToAscii(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length === 0 ? 'video' : slug;
};

export const datePrefix = (mtimeMs: number): string => {
  const date = new Date(mtimeMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

export const finalVideoName = (mtimeMs: number, suggestedFilename: string): string =>
  `${datePrefix(mtimeMs)}_${normalizeKebabSlug(suggestedFilename)}`;

export const uniqueFilename = async (
  fs: FileSystemPort,
  folder: string,
  baseName: string,
  extension: string,
): Promise<Result<string, AppError>> => {
  let counter = 1;
  let candidate = `${baseName}${extension}`;
  let exists = await fs.exists(fs.join(folder, candidate));
  if (!exists.ok) return exists;
  while (exists.value) {
    counter += 1;
    candidate = `${baseName}-${counter}${extension}`;
    exists = await fs.exists(fs.join(folder, candidate));
    if (!exists.ok) return exists;
  }
  return ok(candidate);
};
