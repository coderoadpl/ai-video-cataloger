import { mkdir, mkdtemp, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  catalogMediaRoots,
  parseMediaUrl,
  resolveRegisteredRevealPath,
  resolveRevealPath,
  resolveScopedImage,
  resolveScopedMedia,
  resolveScopedPath,
} from './media-scope.js';

const tempRoots: string[] = [];

describe('parseMediaUrl', () => {
  it('decodes media://local absolute paths and rejects malformed values', () => {
    const requestedPath = '/tmp/video/thumb.jpg';

    expect(parseMediaUrl(`media://local/${encodeURIComponent(requestedPath)}?v=1`)).toBe(requestedPath);
    expect(parseMediaUrl('media://other/%2Ftmp%2Fthumb.jpg')).toBeNull();
    expect(parseMediaUrl('media://local/%E0%A4%A')).toBeNull();
  });
});

describe('resolveScopedImage', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('allows jpg/jpeg/png/webp files inside the current folder scope', async () => {
    const root = await tempRoot();
    const imagePath = path.join(root, 'thumb.JPG');
    await writeFile(imagePath, 'image', 'utf8');

    expect(await resolveScopedImage(imagePath, root)).toBe(await realpath(imagePath));
  });

  it('rejects null roots, unsupported extensions, directories, and oversize files', async () => {
    const root = await tempRoot();
    const textPath = path.join(root, 'thumb.gif');
    const directoryPath = path.join(root, 'folder.jpg');
    const largePath = path.join(root, 'large.jpg');
    await writeFile(textPath, 'image', 'utf8');
    await mkdir(directoryPath);
    await writeFile(largePath, '', 'utf8');
    await truncate(largePath, 20 * 1024 * 1024 + 1);

    expect(await resolveScopedImage(textPath, root)).toBeNull();
    expect(await resolveScopedImage(directoryPath, root)).toBeNull();
    expect(await resolveScopedImage(largePath, root)).toBeNull();
    expect(await resolveScopedImage(path.join(root, 'missing.jpg'), null)).toBeNull();
  });

  it('rejects traversal and symlink escapes after realpath resolution', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsideImage = path.join(outside, 'outside.jpg');
    const linkPath = path.join(root, 'linked.jpg');
    await writeFile(outsideImage, 'image', 'utf8');
    await symlink(outsideImage, linkPath);

    expect(await resolveScopedImage(outsideImage, root)).toBeNull();
    expect(await resolveScopedImage(linkPath, root)).toBeNull();
  });

  it('allows images inside an extra faces scope', async () => {
    const root = await tempRoot();
    const facesRoot = await tempRoot();
    const cropPath = path.join(facesRoot, 'p1', 'exemplar-001.jpg');
    await mkdir(path.dirname(cropPath), { recursive: true });
    await writeFile(cropPath, 'image', 'utf8');

    expect(await resolveScopedImage(cropPath, root, undefined, [{ path: facesRoot }])).toBe(await realpath(cropPath));
  });
});

describe('resolveScopedPath', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('allows an existing target inside the current folder', async () => {
    const root = await tempRoot();
    const target = path.join(root, 'clip.mp4');
    await writeFile(target, 'video', 'utf8');

    expect(await resolveScopedPath(target, root)).toBe(await realpath(target));
  });

  it('rejects targets outside the current folder and symlink escapes', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsideTarget = path.join(outside, 'private.txt');
    const linkPath = path.join(root, 'linked.txt');
    await writeFile(outsideTarget, 'private', 'utf8');
    await symlink(outsideTarget, linkPath);

    expect(await resolveScopedPath(outsideTarget, root)).toBeNull();
    expect(await resolveScopedPath(linkPath, root)).toBeNull();
    expect(await resolveScopedPath(path.join(root, 'missing.txt'), root)).toBeNull();
  });
});

describe('resolveScopedMedia', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('allows supported video files inside the current folder and rejects videos from extra roots', async () => {
    const root = await tempRoot();
    const facesRoot = await tempRoot();
    const videoPath = path.join(root, 'clip.mp4');
    const outsideVideoPath = path.join(facesRoot, 'clip.mp4');
    await writeFile(videoPath, 'video', 'utf8');
    await writeFile(outsideVideoPath, 'video', 'utf8');

    expect(await resolveScopedMedia(videoPath, root, [{ path: facesRoot }])).toBe(await realpath(videoPath));
    expect(await resolveScopedMedia(outsideVideoPath, root, [{ path: facesRoot }])).toBeNull();
  });

  it('serves mirrored artifacts of a read-only folder and refuses traversal out of that mirror', async () => {
    const home = await tempRoot();
    const readOnlyFolder = await tempRoot();
    const mirrorRoot = path.join(home, '.ai-video-cataloger', 'read-only-folders');
    const thumbnailPath = path.join(mirrorRoot, 'derived-folder-id', 'thumbnails', 'clip.jpg');
    const framePath = path.join(mirrorRoot, 'derived-folder-id', 'frames', 'clip', 'frame_001.jpg');
    const secretPath = path.join(home, '.ai-video-cataloger', 'stolen.jpg');
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await mkdir(path.dirname(framePath), { recursive: true });
    await writeFile(thumbnailPath, 'image', 'utf8');
    await writeFile(framePath, 'image', 'utf8');
    await writeFile(secretPath, 'image', 'utf8');
    const roots = catalogMediaRoots(home, ['derived-folder-id']);

    expect(await resolveScopedMedia(thumbnailPath, readOnlyFolder, roots)).toBe(await realpath(thumbnailPath));
    expect(await resolveScopedMedia(framePath, readOnlyFolder, roots)).toBe(await realpath(framePath));
    expect(await resolveScopedMedia(secretPath, readOnlyFolder, roots)).toBeNull();
    expect(await resolveScopedMedia(path.join(mirrorRoot, '..', 'stolen.jpg'), readOnlyFolder, roots)).toBeNull();
    expect(await resolveScopedMedia(path.join(mirrorRoot, 'id', '..', '..', 'stolen.jpg'), readOnlyFolder, roots)).toBeNull();
  });

  it('refuses a mirror of a folder the catalog does not know', async () => {
    const home = await tempRoot();
    const readOnlyFolder = await tempRoot();
    const mirrorRoot = path.join(home, '.ai-video-cataloger', 'read-only-folders');
    const knownThumbnail = path.join(mirrorRoot, 'known-folder-id', 'thumbnails', 'clip.jpg');
    const strangerThumbnail = path.join(mirrorRoot, 'stranger-folder-id', 'thumbnails', 'clip.jpg');
    await mkdir(path.dirname(knownThumbnail), { recursive: true });
    await mkdir(path.dirname(strangerThumbnail), { recursive: true });
    await writeFile(knownThumbnail, 'image', 'utf8');
    await writeFile(strangerThumbnail, 'image', 'utf8');
    const roots = catalogMediaRoots(home, ['known-folder-id']);

    expect(await resolveScopedMedia(knownThumbnail, readOnlyFolder, roots)).toBe(await realpath(knownThumbnail));
    expect(await resolveScopedMedia(strangerThumbnail, readOnlyFolder, roots)).toBeNull();
    expect(await resolveScopedMedia(mirrorRoot, readOnlyFolder, roots)).toBeNull();
  });

  it('refuses a video smuggled into the mirrored artifact root', async () => {
    const home = await tempRoot();
    const readOnlyFolder = await tempRoot();
    const mirrorVideoPath = path.join(home, '.ai-video-cataloger', 'read-only-folders', 'derived-folder-id', 'clip.mp4');
    await mkdir(path.dirname(mirrorVideoPath), { recursive: true });
    await writeFile(mirrorVideoPath, 'video', 'utf8');

    expect(await resolveScopedMedia(mirrorVideoPath, readOnlyFolder, catalogMediaRoots(home, ['derived-folder-id']))).toBeNull();
  });

  it('rejects a symlink inside the mirror that escapes to a file outside every scope', async () => {
    const home = await tempRoot();
    const readOnlyFolder = await tempRoot();
    const outside = await tempRoot();
    const outsideImage = path.join(outside, 'outside.jpg');
    const linkPath = path.join(home, '.ai-video-cataloger', 'read-only-folders', 'id', 'linked.jpg');
    await mkdir(path.dirname(linkPath), { recursive: true });
    await writeFile(outsideImage, 'image', 'utf8');
    await symlink(outsideImage, linkPath);

    expect(await resolveScopedMedia(linkPath, readOnlyFolder, catalogMediaRoots(home, ['id']))).toBeNull();
  });
});

describe('catalogMediaRoots', () => {
  it('scopes media to the faces root, the mirrors of the folders it is given, and the static photo-artifacts root', () => {
    expect(catalogMediaRoots('/home/u', ['folder-a', 'folder-b'])).toEqual([
      { path: path.join('/home/u', '.ai-video-cataloger', 'faces') },
      {
        path: path.join('/home/u', '.ai-video-cataloger', 'read-only-folders'),
        allowedChildren: new Set(['folder-a', 'folder-b']),
      },
      { path: path.join('/home/u', '.ai-video-cataloger', 'photo-artifacts') },
    ]);
  });

  it('also admits the sidecar dir of every writable catalog folder it is given', () => {
    expect(catalogMediaRoots('/home/u', [], ['/drives/a', '/drives/b'])).toEqual([
      { path: path.join('/home/u', '.ai-video-cataloger', 'faces') },
      { path: path.join('/home/u', '.ai-video-cataloger', 'read-only-folders'), allowedChildren: new Set() },
      { path: path.join('/home/u', '.ai-video-cataloger', 'photo-artifacts') },
      { path: path.join('/drives/a', '.ai-video-cataloger') },
      { path: path.join('/drives/b', '.ai-video-cataloger') },
      { path: '/drives/a', grants: 'media' },
      { path: '/drives/b', grants: 'media' },
    ]);
  });
});

describe('a non-current writable catalog folder sidecar (Library spec 1, media-scope fix)', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('resolves both a thumbnail and the video beside it under a known, non-current writable catalog folder', async () => {
    const home = await tempRoot();
    const currentFolder = await tempRoot();
    const otherCatalogFolder = await tempRoot();
    const thumbnailPath = path.join(otherCatalogFolder, '.ai-video-cataloger', 'artifacts', 'thumb.jpg');
    const videoPath = path.join(otherCatalogFolder, 'clip.mp4');
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, 'image', 'utf8');
    await writeFile(videoPath, 'video', 'utf8');
    const roots = catalogMediaRoots(home, [], [otherCatalogFolder]);

    expect(await resolveScopedMedia(thumbnailPath, currentFolder, roots)).toBe(await realpath(thumbnailPath));
    expect(await resolveScopedMedia(videoPath, currentFolder, roots)).toBe(await realpath(videoPath));
  });

  it('refuses a sidecar of a folder the catalog does not know about', async () => {
    const home = await tempRoot();
    const currentFolder = await tempRoot();
    const strangerFolder = await tempRoot();
    const thumbnailPath = path.join(strangerFolder, '.ai-video-cataloger', 'artifacts', 'thumb.jpg');
    const strangerVideoPath = path.join(strangerFolder, 'clip.mp4');
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, 'image', 'utf8');
    await writeFile(strangerVideoPath, 'video', 'utf8');
    const roots = catalogMediaRoots(home, [], []);

    expect(await resolveScopedMedia(thumbnailPath, currentFolder, roots)).toBeNull();
    expect(await resolveScopedMedia(strangerVideoPath, currentFolder, roots)).toBeNull();
  });

  it('never grants video access through an images-only mirror root alone', async () => {
    const home = await tempRoot();
    const currentFolder = await tempRoot();
    const mirrorVideoPath = path.join(home, '.ai-video-cataloger', 'read-only-folders', 'known-id', 'clip.mp4');
    await mkdir(path.dirname(mirrorVideoPath), { recursive: true });
    await writeFile(mirrorVideoPath, 'video', 'utf8');
    const roots = catalogMediaRoots(home, ['known-id']);

    expect(await resolveScopedMedia(mirrorVideoPath, currentFolder, roots)).toBeNull();
  });

  it('rejects a symlink inside a non-current catalog folder that escapes to a file outside every scope', async () => {
    const home = await tempRoot();
    const currentFolder = await tempRoot();
    const otherCatalogFolder = await tempRoot();
    const outside = await tempRoot();
    const outsideVideoPath = path.join(outside, 'secret.mp4');
    const linkPath = path.join(otherCatalogFolder, 'linked.mp4');
    await writeFile(outsideVideoPath, 'video', 'utf8');
    await symlink(outsideVideoPath, linkPath);
    const roots = catalogMediaRoots(home, [], [otherCatalogFolder]);

    expect(await resolveScopedMedia(linkPath, currentFolder, roots)).toBeNull();
  });
});

describe('photo-artifacts media scope (P1)', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('serves a proxy jpg under the static photo-artifacts root with a null current folder', async () => {
    const home = await tempRoot();
    const proxyPath = path.join(home, '.ai-video-cataloger', 'photo-artifacts', 'proxies', 'abc123.jpg');
    await mkdir(path.dirname(proxyPath), { recursive: true });
    await writeFile(proxyPath, 'image', 'utf8');
    const roots = catalogMediaRoots(home, []);

    expect(await resolveScopedImage(proxyPath, null, undefined, roots)).toBe(await realpath(proxyPath));
  });

  it('refuses a jpg inside an arbitrary photo folder outside every scope', async () => {
    const home = await tempRoot();
    const photoFolder = await tempRoot();
    const originalPath = path.join(photoFolder, 'IMG_0001.jpg');
    await writeFile(originalPath, 'image', 'utf8');
    const roots = catalogMediaRoots(home, []);

    expect(await resolveScopedImage(originalPath, null, undefined, roots)).toBeNull();
  });

  it('refuses an .arw placed under the photo-artifacts root (allowlist unchanged)', async () => {
    const home = await tempRoot();
    const arwPath = path.join(home, '.ai-video-cataloger', 'photo-artifacts', 'proxies', 'abc123.arw');
    await mkdir(path.dirname(arwPath), { recursive: true });
    await writeFile(arwPath, 'raw-bytes', 'utf8');
    const roots = catalogMediaRoots(home, []);

    expect(await resolveScopedImage(arwPath, null, undefined, roots)).toBeNull();
  });
});

describe('resolveRevealPath', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('reveals a target under any known catalog folder, not only the current one', async () => {
    const current = await tempRoot();
    const otherCatalogFolder = await tempRoot();
    const target = path.join(otherCatalogFolder, 'clip.mp4');
    await writeFile(target, 'video', 'utf8');

    expect(await resolveRevealPath(target, [current, otherCatalogFolder])).toBe(await realpath(target));
  });

  it('rejects a target outside every known folder and skips null entries', async () => {
    const current = await tempRoot();
    const outside = await tempRoot();
    const target = path.join(outside, 'clip.mp4');
    await writeFile(target, 'video', 'utf8');

    expect(await resolveRevealPath(target, [null, current])).toBeNull();
    expect(await resolveRevealPath('relative/clip.mp4', [current])).toBeNull();
  });

  it('admits a photo only while its photo root remains registered', async () => {
    const current = await tempRoot();
    const photoRoot = await tempRoot();
    const target = path.join(photoRoot, 'trip', 'photo.jpg');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'photo', 'utf8');
    const registeredRoots = [photoRoot];

    expect(await resolveRegisteredRevealPath(target, current, [], registeredRoots)).toBe(await realpath(target));
    registeredRoots.length = 0;
    expect(await resolveRegisteredRevealPath(target, current, [], registeredRoots)).toBeNull();
  });
});

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-desktop-media-'));
  tempRoots.push(root);
  return root;
};
