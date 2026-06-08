/**
 * Pure path-scoping logic for the media:// protocol.
 *
 * This module intentionally has NO electron imports so it can be unit tested
 * directly with vitest.
 */

import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Resolve a requested image path against the currently scoped root folder.
 *
 * Returns the realpath of the file when ALL of the following hold:
 * - a root folder is set
 * - the file extension is in the image allowlist
 * - both root and requested path resolve via realpath (symlinks normalized)
 * - the resolved path is inside the resolved root (no traversal escape)
 * - the target is a regular file no larger than maxBytes
 *
 * Returns null otherwise.
 */
export async function resolveScopedImage(
  requestedPath: string,
  rootFolder: string | null,
  maxBytes = 20 * 1024 * 1024
): Promise<string | null> {
  if (rootFolder === null) {
    return null;
  }

  const ext = path.extname(requestedPath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return null;
  }

  let realRoot: string;
  let realRequested: string;
  try {
    realRoot = await realpath(rootFolder);
    realRequested = await realpath(requestedPath);
  } catch {
    // Root or requested path does not exist (or is otherwise unresolvable)
    return null;
  }

  const relative = path.relative(realRoot, realRequested);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  try {
    const stats = await stat(realRequested);
    if (!stats.isFile()) {
      return null;
    }
    if (stats.size > maxBytes) {
      return null;
    }
  } catch {
    return null;
  }

  return realRequested;
}
