import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export interface MediaRoot {
  path: string;
  allowedChildren?: ReadonlySet<string> | undefined;
}

// A folder the app cannot write keeps its thumbnails and frames in the home mirror, not beside the
// video, so scoping media to the opened folder alone leaves every read-only folder blank — search
// renders those thumbnails for folders that are not the current one. The mirror is admitted one
// folder id at a time instead of wholesale: only the folders the catalog knows can be read.
// A writable catalog folder keeps its thumbnails/frames beside the video, in its own
// `.ai-video-cataloger` sidecar — not the home mirror above. Without an explicit root per known
// folder, only the currently-open folder's sidecar was reachable, so search/Library thumbnails from
// any other writable catalog folder rendered blank (Library spec 1, media-scope fix).
export const catalogMediaRoots = (
  homeDirectory: string,
  mirrorFolderIds: Iterable<string>,
  catalogFolderPaths: readonly string[] = [],
): readonly MediaRoot[] => [
  { path: path.join(homeDirectory, '.ai-video-cataloger', 'faces') },
  {
    path: path.join(homeDirectory, '.ai-video-cataloger', 'read-only-folders'),
    allowedChildren: new Set(mirrorFolderIds),
  },
  { path: path.join(homeDirectory, '.ai-video-cataloger', 'photo-artifacts') },
  ...catalogFolderPaths.map((folderPath) => ({ path: path.join(folderPath, '.ai-video-cataloger') })),
];

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
  extraRoots: readonly MediaRoot[] = [],
): Promise<string | null> => {
  if (!ALLOWED_EXTENSIONS.has(path.extname(requestedPath).toLowerCase())) return null;

  const realRequested = await resolveAnyScopedPath(
    requestedPath,
    rootFolder === null ? extraRoots : [{ path: rootFolder }, ...extraRoots],
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
  extraRoots: readonly MediaRoot[] = [],
): Promise<string | null> => {
  const extension = path.extname(requestedPath).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(extension)) return resolveScopedImage(requestedPath, rootFolder, MAX_MEDIA_BYTES, extraRoots);
  if (!ALLOWED_VIDEO_EXTENSIONS.has(extension)) return null;

  const realRequested = await resolveAnyScopedPath(
    requestedPath,
    rootFolder === null ? [] : [{ path: rootFolder }],
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

export const resolveRevealPath = async (
  requestedPath: string,
  rootFolders: readonly (string | null)[],
): Promise<string | null> => {
  if (!path.isAbsolute(requestedPath)) return null;
  const roots = rootFolders
    .filter((folder): folder is string => folder !== null)
    .map((folder) => ({ path: folder }));
  return resolveAnyScopedPath(requestedPath, roots);
};

const resolveAnyScopedPath = async (
  requestedPath: string,
  roots: readonly MediaRoot[],
): Promise<string | null> => {
  for (const root of roots) {
    const scoped = await resolveWithinRoot(requestedPath, root);
    if (scoped !== null) return scoped;
  }
  return null;
};

export const resolveScopedPath = async (
  requestedPath: string,
  rootFolder: string | null,
): Promise<string | null> =>
  rootFolder === null ? null : resolveWithinRoot(requestedPath, { path: rootFolder });

const resolveWithinRoot = async (requestedPath: string, root: MediaRoot): Promise<string | null> => {
  if (!path.isAbsolute(requestedPath)) return null;

  let realRoot: string;
  let realRequested: string;
  try {
    realRoot = await realpath(root.path);
    realRequested = await realpath(requestedPath);
  } catch {
    return null;
  }

  const relative = path.relative(realRoot, realRequested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  if (root.allowedChildren !== undefined && !root.allowedChildren.has(relative.split(path.sep)[0] ?? '')) return null;
  return realRequested;
};
