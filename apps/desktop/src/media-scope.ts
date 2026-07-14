import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export const parseMediaUrl = (urlValue: string): string | null => {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== 'media:' || url.hostname !== 'local') return null;
    const encoded = url.pathname.replace(/^\//, '');
    if (encoded.length === 0) return null;
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
};

export const resolveScopedImage = async (
  requestedPath: string,
  rootFolder: string | null,
  maxBytes = MAX_MEDIA_BYTES,
): Promise<string | null> => {
  if (rootFolder === null) return null;
  if (!ALLOWED_EXTENSIONS.has(path.extname(requestedPath).toLowerCase())) return null;

  const realRequested = await resolveScopedPath(requestedPath, rootFolder);
  if (realRequested === null) return null;

  try {
    const stats = await stat(realRequested);
    if (!stats.isFile()) return null;
    if (stats.size > maxBytes) return null;
  } catch {
    return null;
  }

  return realRequested;
};

export const resolveScopedPath = async (
  requestedPath: string,
  rootFolder: string | null,
): Promise<string | null> => {
  if (rootFolder === null || !path.isAbsolute(requestedPath)) return null;

  let realRoot: string;
  let realRequested: string;
  try {
    realRoot = await realpath(rootFolder);
    realRequested = await realpath(requestedPath);
  } catch {
    return null;
  }

  const relative = path.relative(realRoot, realRequested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return realRequested;
};
