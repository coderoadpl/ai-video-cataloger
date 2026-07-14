import { mkdir, mkdtemp, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseMediaUrl, resolveScopedImage, resolveScopedPath } from './media-scope.js';

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

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-desktop-media-'));
  tempRoots.push(root);
  return root;
};
