import { describe, expect, it } from 'vitest';

import {
  buildPhotoTreeForRoot,
  buildPhotoTrees,
  photoScopePendingCount,
  type PhotoTreeFolderData,
} from './photos-tree-model.js';

const folder = (overrides: Partial<PhotoTreeFolderData>): PhotoTreeFolderData => ({
  path: '/media/photos',
  name: 'photos',
  relativePath: '',
  root: '/media/photos',
  depth: 0,
  photoCount: 0,
  analysedCount: 0,
  ...overrides,
});

describe('buildPhotoTrees', () => {
  it('nests a subfolder under its root and aggregates counts upward', () => {
    const [tree] = buildPhotoTrees([
      folder({ relativePath: '', photoCount: 1, analysedCount: 1 }),
      folder({ path: '/media/photos/trip', name: 'trip', relativePath: 'trip', depth: 1, photoCount: 2, analysedCount: 0 }),
    ]);
    expect(tree).toMatchObject({ relativePath: '', depth: 0, photoCount: 3, analysedCount: 1, directPhotoCount: 1 });
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0]).toMatchObject({ relativePath: 'trip', name: 'trip', depth: 1, photoCount: 2, analysedCount: 0, directPhotoCount: 2 });
  });

  it('synthesizes a zero-count intermediate folder that only owns a grandchild', () => {
    const [tree] = buildPhotoTrees([
      folder({
        path: '/media/photos/a/b',
        name: 'b',
        relativePath: 'a/b',
        depth: 2,
        photoCount: 5,
        analysedCount: 2,
      }),
    ]);
    expect(tree).toMatchObject({ relativePath: '', directPhotoCount: 0, photoCount: 5, analysedCount: 2 });
    const [a] = tree?.children ?? [];
    expect(a).toMatchObject({ relativePath: 'a', name: 'a', depth: 1, directPhotoCount: 0, photoCount: 5, analysedCount: 2 });
    const [b] = a?.children ?? [];
    expect(b).toMatchObject({ relativePath: 'a/b', name: 'b', depth: 2, directPhotoCount: 5, photoCount: 5, analysedCount: 2 });
  });

  it('builds one independent tree per physical root, sorted by root path', () => {
    const trees = buildPhotoTrees([
      folder({ path: '/z/photos', name: 'photos', relativePath: '', root: '/z/photos', photoCount: 1 }),
      folder({ path: '/a/photos', name: 'photos', relativePath: '', root: '/a/photos', photoCount: 2 }),
    ]);
    expect(trees.map((node) => node.root)).toEqual(['/a/photos', '/z/photos']);
    expect(trees.map((node) => node.photoCount)).toEqual([2, 1]);
  });

  it('sorts children alphabetically by relative path', () => {
    const [tree] = buildPhotoTrees([
      folder({ relativePath: '' }),
      folder({ path: '/media/photos/zebra', name: 'zebra', relativePath: 'zebra', depth: 1, photoCount: 1 }),
      folder({ path: '/media/photos/apple', name: 'apple', relativePath: 'apple', depth: 1, photoCount: 1 }),
    ]);
    expect(tree?.children.map((child) => child.name)).toEqual(['apple', 'zebra']);
  });
});

describe('buildPhotoTreeForRoot', () => {
  it('derives only the current root and excludes every other registered root', () => {
    const tree = buildPhotoTreeForRoot([
      folder({ path: '/media/current', root: '/media/current', relativePath: '', photoCount: 2, analysedCount: 1 }),
      folder({ path: '/media/current/trip', root: '/media/current', relativePath: 'trip', depth: 1, photoCount: 3, analysedCount: 1 }),
      folder({ path: '/home/Pictures', root: '/home/Pictures', relativePath: '', photoCount: 40, analysedCount: 30 }),
      folder({ path: '/tmp/old-test', root: '/tmp/old-test', relativePath: '', photoCount: 10, analysedCount: 0 }),
    ], '/media/current');

    expect(tree).toMatchObject({ root: '/media/current', photoCount: 5, analysedCount: 2 });
    expect(tree?.children.map((child) => child.path)).toEqual(['/media/current/trip']);
  });
});

describe('photoScopePendingCount', () => {
  it('counts only direct pending photos for folder scope and the full subtree for tree scope', () => {
    const tree = buildPhotoTreeForRoot([
      folder({ path: '/media/current', root: '/media/current', relativePath: '', photoCount: 4, analysedCount: 1 }),
      folder({ path: '/media/current/trip', root: '/media/current', relativePath: 'trip', depth: 1, photoCount: 5, analysedCount: 2 }),
      folder({ path: '/home/Pictures', root: '/home/Pictures', relativePath: '', photoCount: 100, analysedCount: 0 }),
    ], '/media/current');

    expect(photoScopePendingCount(tree, 'folder')).toBe(3);
    expect(photoScopePendingCount(tree, 'tree')).toBe(6);
  });
});
