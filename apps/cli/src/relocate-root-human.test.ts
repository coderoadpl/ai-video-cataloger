import { describe, expect, it } from 'vitest';

import { relocateRootHuman, relocateRootIncomplete, type RelocateRootOutput } from './relocate-root-human.js';

const plan = (overrides: Partial<RelocateRootOutput> = {}): RelocateRootOutput => ({
  from: '/Volumes/test-drive',
  to: '/Volumes/fixture-drive',
  media: 'all',
  apply: false,
  applied: false,
  targetMounted: true,
  databases: [
    {
      media: 'video',
      databasePath: '/data/.ai-video-cataloger/catalog.db',
      folders: 2,
      files: 5,
      paths: 0,
      idChanges: 1,
      mirrorsToRename: 1,
      runs: 1,
      gridThumbnails: 3,
      examples: [{
        fromPath: '/Volumes/test-drive/trip',
        toPath: '/Volumes/fixture-drive/trip',
        fromFolderId: 'path-00000001',
        toFolderId: 'path-00000002',
        mirror: { from: '/m/path-00000001', to: '/m/path-00000002' },
      }],
    },
    {
      media: 'photo',
      databasePath: '/data/.ai-video-cataloger/photos.db',
      folders: 0,
      files: 0,
      paths: 0,
      idChanges: 0,
      mirrorsToRename: 0,
      runs: 0,
      gridThumbnails: 0,
      examples: [],
    },
  ],
  collisions: [],
  warnings: [],
  backupDirectory: null,
  remaining: null,
  ...overrides,
});

describe('relocateRootHuman', () => {
  it('prints per-database counts, examples and the remainder of the folder list', () => {
    expect(relocateRootHuman(plan())).toBe([
      'Dry run: /Volumes/test-drive -> /Volumes/fixture-drive (nothing changed; add --apply to rewrite)',
      'video (/data/.ai-video-cataloger/catalog.db): 2 folders, 5 files, 1 ids change, 1 mirrors to rename, 1 drive runs, 3 grid thumbnails',
      '  /Volumes/test-drive/trip -> /Volumes/fixture-drive/trip [path-00000001 -> path-00000002] (mirror renamed)',
      '  ... and 1 more folders',
      'photo (/data/.ai-video-cataloger/photos.db): 0 folders, 0 photos, 0 photo paths, 0 ids change, 0 photo runs',
    ].join('\n'));
  });

  it('lists collisions, warnings, the backup directory and the verification', () => {
    const output = relocateRootHuman(plan({
      applied: true,
      collisions: [{ media: 'photo', kind: 'photo_path', fromPath: '/Volumes/test-drive/a.jpg', target: '/Volumes/fixture-drive/a.jpg' }],
      warnings: ['/Volumes/fixture-drive is not mounted'],
      backupDirectory: '/data/.ai-video-cataloger/backups/x--relocate-root',
      remaining: [{ media: 'video', folders: 0, paths: 0, runs: 0 }],
    }));

    expect(output).toContain('Rewrote /Volumes/test-drive -> /Volumes/fixture-drive');
    expect(output).toContain('  photo photo_path: /Volumes/test-drive/a.jpg -> /Volumes/fixture-drive/a.jpg');
    expect(output).toContain('Warning: /Volumes/fixture-drive is not mounted');
    expect(output).toContain('Backups: /data/.ai-video-cataloger/backups/x--relocate-root');
    expect(output.split('\n').at(-1)).toBe(`Remaining under ${plan().from}: video 0 folders, 0 paths, 0 runs`);
  });
});

describe('relocateRootIncomplete', () => {
  it('flags collisions and leftover rows only', () => {
    expect(relocateRootIncomplete(plan())).toBe(false);
    expect(relocateRootIncomplete(plan({ remaining: [{ media: 'video', folders: 0, paths: 0, runs: 0 }] }))).toBe(false);
    expect(relocateRootIncomplete(plan({ remaining: [{ media: 'photo', folders: 0, paths: 2, runs: 0 }] }))).toBe(true);
    expect(relocateRootIncomplete(plan({
      collisions: [{ media: 'video', kind: 'mirror', fromPath: '/a', target: '/b' }],
    }))).toBe(true);
  });
});
