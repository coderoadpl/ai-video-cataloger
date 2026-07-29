import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeTree, treeDifference } from './ro-mount.js';

describe('ro-mount tree helpers', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'avc-ro-mount-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists files, nested directories and dotfiles, sorted, with posix-relative paths', () => {
    mkdirSync(join(root, 'clips', 'nested'), { recursive: true });
    writeFileSync(join(root, '.dotfile'), 'dot');
    writeFileSync(join(root, 'clips', 'a.mp4'), 'a');
    writeFileSync(join(root, 'clips', 'nested', 'b.mp4'), 'bb');

    const tree = describeTree(root);

    expect(tree.map((entry) => entry.path)).toEqual([
      '.dotfile',
      'clips',
      'clips/a.mp4',
      'clips/nested',
      'clips/nested/b.mp4',
    ]);
    expect(tree.find((entry) => entry.path === 'clips')?.kind).toBe('directory');
    expect(tree.find((entry) => entry.path === 'clips/a.mp4')).toMatchObject({ kind: 'file', size: 1 });
  });

  it('reports no difference for two snapshots of an untouched tree', () => {
    writeFileSync(join(root, 'unchanged.txt'), 'same');

    const before = describeTree(root);
    const after = describeTree(root);

    expect(treeDifference(before, after)).toEqual([]);
  });

  it('names an added file, a removed file, and a file whose size changed', () => {
    writeFileSync(join(root, 'stays.txt'), 'x');
    writeFileSync(join(root, 'shrinks.txt'), 'original');
    const before = describeTree(root);

    writeFileSync(join(root, 'shrinks.txt'), 'a');
    writeFileSync(join(root, 'new.txt'), 'added');
    rmSync(join(root, 'stays.txt'));
    const after = describeTree(root);

    const difference = treeDifference(before, after);
    expect(difference).toContain('added: new.txt');
    expect(difference).toContain('removed: stays.txt');
    expect(difference.some((line) => line.startsWith('changed: shrinks.txt (size'))).toBe(true);
  });

  it('names a file whose mtimeMs changed with identical size', () => {
    const filePath = join(root, 'touched.txt');
    writeFileSync(filePath, 'same-size');
    const before = describeTree(root);

    const future = new Date(Date.now() + 60_000);
    utimesSync(filePath, future, future);
    const after = describeTree(root);

    const difference = treeDifference(before, after);
    expect(difference.some((line) => line.startsWith('changed: touched.txt (mtimeMs'))).toBe(true);
  });
});
