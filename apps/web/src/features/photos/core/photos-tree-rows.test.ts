import { describe, expect, it } from 'vitest';

import type { PhotoListItem } from './photo-list-item.js';
import { buildPhotoTrees, type PhotoTreeFolderData } from './photos-tree-model.js';
import { buildPhotoTreeRows, photoFolderKey, type LoadedPhotoFolder } from './photos-tree-rows.js';

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

const photoItem = (overrides: Partial<PhotoListItem>): PhotoListItem => ({
  fingerprint: 'ph_0000000000000001',
  fileName: 'a.jpg',
  currentPath: '/media/photos/a.jpg',
  ext: 'jpg',
  capturedAt: null,
  capturedAtSource: null,
  width: null,
  height: null,
  proxyState: 'pending',
  thumbState: 'pending',
  missingAt: null,
  sightings: 1,
  thumbPath: null,
  gridThumbPath: null,
  proxyPath: null,
  analysed: false,
  analysisError: null,
  exifReadAt: null,
  ...overrides,
});

const noneLoaded = (): LoadedPhotoFolder | undefined => undefined;

describe('buildPhotoTreeRows', () => {
  it('renders only the root folder row when collapsed', () => {
    const trees = buildPhotoTrees([
      folder({ photoCount: 3 }),
      folder({ path: '/media/photos/trip', name: 'trip', relativePath: 'trip', depth: 1, photoCount: 2 }),
    ]);
    const rows = buildPhotoTreeRows({ roots: trees, isExpanded: () => false, loadedFolder: noneLoaded });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'folder', isRoot: true, expanded: false, depth: 0, photoCount: 5 });
  });

  it('shows a loading status row for an expanded folder whose photos have not arrived yet', () => {
    const trees = buildPhotoTrees([folder({ photoCount: 1 })]);
    const rows = buildPhotoTreeRows({
      roots: trees,
      isExpanded: (key) => key === photoFolderKey('/media/photos', ''),
      loadedFolder: noneLoaded,
    });
    expect(rows.map((row) => row.kind)).toEqual(['folder', 'status']);
    expect(rows[1]).toMatchObject({ kind: 'status', variant: 'loading', depth: 1 });
  });

  it('expanding reveals child folder rows collapsed by default, and loaded photo rows for the folder itself', () => {
    const trees = buildPhotoTrees([
      folder({ photoCount: 1 }),
      folder({ path: '/media/photos/trip', name: 'trip', relativePath: 'trip', depth: 1, photoCount: 2 }),
    ]);
    const rootKey = photoFolderKey('/media/photos', '');
    const rows = buildPhotoTreeRows({
      roots: trees,
      isExpanded: (key) => key === rootKey,
      loadedFolder: (key) => (key === rootKey ? { items: [photoItem({})], isLoading: false, isError: false, error: null } : undefined),
    });
    expect(rows.map((row) => row.kind)).toEqual(['folder', 'photo', 'folder']);
    expect(rows[1]).toMatchObject({ kind: 'photo', depth: 1 });
    expect(rows[2]).toMatchObject({ kind: 'folder', isRoot: false, expanded: false, relativePath: 'trip', depth: 1 });
  });

  it('marks the last row in a subtree isLast and threads ancestorContinues for guide rendering', () => {
    const trees = buildPhotoTrees([
      folder({ photoCount: 0 }),
      folder({ path: '/media/photos/a', name: 'a', relativePath: 'a', depth: 1, photoCount: 0 }),
      folder({ path: '/media/photos/a/b', name: 'b', relativePath: 'a/b', depth: 2, photoCount: 0 }),
      folder({ path: '/media/photos/z', name: 'z', relativePath: 'z', depth: 1, photoCount: 0 }),
    ]);
    const rootKey = photoFolderKey('/media/photos', '');
    const aKey = photoFolderKey('/media/photos', 'a');
    const rows = buildPhotoTreeRows({
      roots: trees,
      isExpanded: (key) => key === rootKey || key === aKey,
      loadedFolder: noneLoaded,
    });
    const names = rows.map((row) => (row.kind === 'folder' ? row.name : row.kind));
    expect(names).toEqual(['photos', 'a', 'b', 'z']);
    const [, aRow, bRow, zRow] = rows;
    expect(aRow).toMatchObject({ isLast: false, ancestorContinues: [] });
    expect(bRow).toMatchObject({ isLast: true, ancestorContinues: [true] });
    expect(zRow).toMatchObject({ isLast: true, ancestorContinues: [] });
  });

  it('flattens multiple roots into one list, each root starting its own depth-0 subtree', () => {
    const trees = buildPhotoTrees([
      folder({ path: '/a/photos', root: '/a/photos', photoCount: 1 }),
      folder({ path: '/z/photos', root: '/z/photos', photoCount: 1 }),
    ]);
    const rows = buildPhotoTreeRows({ roots: trees, isExpanded: () => false, loadedFolder: noneLoaded });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === 'folder' && row.depth === 0 && row.isRoot)).toBe(true);
  });
});
