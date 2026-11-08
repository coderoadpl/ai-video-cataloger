import { describe, expect, it } from 'vitest';

import { relocateRootHuman, relocateRootIncomplete, type RelocateRootOutput } from './relocate-root-human.js';

const plan = (overrides: Partial<RelocateRootOutput> = {}): RelocateRootOutput => ({
  from: '/Volumes/media',
  to: '/Volumes/library',
  media: 'all',
  apply: false,
  applied: false,
  targetMounted: true,
  databases: [
    {
      media: 'video',
      databasePath: '/home/.ai-video-cataloger/catalog.db',
      folders: 2,
      files: 5,
      paths: 0,
      idChanges: 1,
      mirrorsToRename: 1,
      runs: 1,
      gridThumbnails: 3,
      examples: [{
        fromPath: '/Volumes/media/trip',
        toPath: '/Volumes/library/trip',
        fromFolderId: 'path-00000001',
        toFolderId: 'path-00000002',
        mirror: { from: '/m/path-00000001', to: '/m/path-00000002' },
      }],
    },
    {
      media: 'photo',
      databasePath: '/home/.ai-video-cataloger/photos.db',
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
      'Dry run: /Volumes/media -> /Volumes/library (nothing changed; add --apply to rewrite)',
      'video (/home/.ai-video-cataloger/catalog.db): 2 folders, 5 files, 1 ids change, 1 mirrors to rename, 1 drive runs, 3 grid thumbnails',
      '  /Volumes/media/trip -> /Volumes/library/trip [path-00000001 -> path-00000002] (mirror renamed)',
      '  ... and 1 more folders',
      'photo (/home/.ai-video-cataloger/photos.db): 0 folders, 0 photos, 0 photo paths, 0 ids change, 0 photo runs',
    ].join('\n'));
  });

  it('lists collisions, warnings, the backup directory and the verification', () => {
    const output = relocateRootHuman(plan({
      applied: true,
      collisions: [{ media: 'photo', kind: 'photo_path', fromPath: '/Volumes/media/a.jpg', target: '/Volumes/library/a.jpg' }],
      warnings: ['/Volumes/library is not mounted'],
      backupDirectory: '/home/.ai-video-cataloger/backups/x--relocate-root',
      remaining: [{ media: 'video', folders: 0, paths: 0, runs: 0 }],
    }));

    expect(output).toContain('Rewrote /Volumes/media -> /Volumes/library');
    expect(output).toContain('  photo photo_path: /Volumes/media/a.jpg -> /Volumes/library/a.jpg');
    expect(output).toContain('Warning: /Volumes/library is not mounted');
    expect(output).toContain('Backups: /home/.ai-video-cataloger/backups/x--relocate-root');
    expect(output).toContain('Remaining under /Volumes/media: video 0 folders, 0 paths, 0 runs');
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
