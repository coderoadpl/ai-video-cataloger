/**
 * Tests for the pure media:// path-scoping logic (resolveScopedImage).
 * Uses real temp directories so realpath/symlink behavior is exercised.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, symlink, realpath, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDir, cleanupTestDir } from './setup.js';
import { resolveScopedImage } from '../electron/main/media-scope.js';

describe('resolveScopedImage', () => {
  let baseDir: string;
  let rootDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    baseDir = createTestDir();
    rootDir = join(baseDir, 'root');
    outsideDir = join(baseDir, 'outside');
    await mkdir(rootDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
  });

  afterEach(() => {
    cleanupTestDir(baseDir);
  });

  it('accepts a legal jpg inside the root and returns its realpath', async () => {
    const imagePath = join(rootDir, 'frame.jpg');
    await writeFile(imagePath, 'fake-jpg-data');

    const result = await resolveScopedImage(imagePath, rootDir);

    expect(result).toBe(await realpath(imagePath));
  });

  it('accepts a root reached via symlink (realpath normalization on both sides)', async () => {
    const imagePath = join(rootDir, 'frame.png');
    await writeFile(imagePath, 'fake-png-data');

    const rootLink = join(baseDir, 'root-link');
    await symlink(rootDir, rootLink);

    // Request through the symlinked root, scope set to the symlinked root
    const result = await resolveScopedImage(join(rootLink, 'frame.png'), rootLink);

    expect(result).toBe(await realpath(imagePath));
  });

  it('rejects a path outside the root', async () => {
    const imagePath = join(outsideDir, 'frame.jpg');
    await writeFile(imagePath, 'fake-jpg-data');

    const result = await resolveScopedImage(imagePath, rootDir);

    expect(result).toBeNull();
  });

  it('rejects ../ traversal that escapes the root', async () => {
    const imagePath = join(outsideDir, 'escape.jpg');
    await writeFile(imagePath, 'fake-jpg-data');

    const traversalPath = join(rootDir, '..', 'outside', 'escape.jpg');
    const result = await resolveScopedImage(traversalPath, rootDir);

    expect(result).toBeNull();
  });

  it('rejects a symlink inside the root pointing outside the root', async () => {
    const targetPath = join(outsideDir, 'secret.jpg');
    await writeFile(targetPath, 'fake-jpg-data');

    const linkPath = join(rootDir, 'sneaky.jpg');
    await symlink(targetPath, linkPath);

    const result = await resolveScopedImage(linkPath, rootDir);

    expect(result).toBeNull();
  });

  it('rejects a disallowed extension', async () => {
    const filePath = join(rootDir, 'notes.txt');
    await writeFile(filePath, 'not an image');

    const result = await resolveScopedImage(filePath, rootDir);

    expect(result).toBeNull();
  });

  it('rejects a file bigger than maxBytes', async () => {
    const imagePath = join(rootDir, 'big.jpg');
    await writeFile(imagePath, 'x'.repeat(100));

    const result = await resolveScopedImage(imagePath, rootDir, 10);

    expect(result).toBeNull();
  });

  it('rejects when root is null', async () => {
    const imagePath = join(rootDir, 'frame.jpg');
    await writeFile(imagePath, 'fake-jpg-data');

    const result = await resolveScopedImage(imagePath, null);

    expect(result).toBeNull();
  });

  it('rejects a nonexistent file', async () => {
    const result = await resolveScopedImage(join(rootDir, 'missing.jpg'), rootDir);

    expect(result).toBeNull();
  });
});
