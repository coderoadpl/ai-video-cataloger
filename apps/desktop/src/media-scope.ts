import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
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
  extraRoots: readonly string[] = [],
): Promise<string | null> => {
  if (!ALLOWED_EXTENSIONS.has(path.extname(requestedPath).toLowerCase())) return null;

  const realRequested = await resolveAnyScopedPath(
    requestedPath,
    rootFolder === null ? extraRoots : [rootFolder, ...extraRoots],
  );
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

export const resolveScopedMedia = async (
  requestedPath: string,
  rootFolder: string | null,
  extraRoots: readonly string[] = [],
): Promise<string | null> => {
  const extension = path.extname(requestedPath).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(extension)) return resolveScopedImage(requestedPath, rootFolder, MAX_MEDIA_BYTES, extraRoots);
  if (!ALLOWED_VIDEO_EXTENSIONS.has(extension)) return null;

  const realRequested = await resolveAnyScopedPath(
    requestedPath,
    rootFolder === null ? [] : [rootFolder],
  );
  if (realRequested === null) return null;

  try {
    const stats = await stat(realRequested);
    if (!stats.isFile()) return null;
  } catch {
    return null;
  }

  return realRequested;
};

const resolveAnyScopedPath = async (
  requestedPath: string,
  rootFolders: readonly string[],
): Promise<string | null> => {
  for (const rootFolder of rootFolders) {
    const scoped = await resolveScopedPath(requestedPath, rootFolder);
    if (scoped !== null) return scoped;
  }
  return null;
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
