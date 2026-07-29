import { describe, expect, it } from 'vitest';

import { discoverArtifactRoot, folderArtifactRoot, readOnlyArtifactRoot, readOnlyArtifactRootById } from './artifact-root.js';
import { InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';

const legacyDerivedFolderId = (folder: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < folder.length; index += 1) {
    hash = Math.imul(hash ^ folder.charCodeAt(index), 16_777_619);
  }
  return `path-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

describe('discoverArtifactRoot', () => {
  it('returns the writable folder root when a folder marker is present', async () => {
    const fs = new InMemoryFileSystem('/work');
    const folder = '/work/videos';
    fs.addFile(`${folder}/.ai-video-cataloger/.folder-marker.json`, {
      content: JSON.stringify({ folderId: 'x', schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
    });

    const result = await discoverArtifactRoot(fs, folder);

    expect(result).toEqual({ ok: true, value: folderArtifactRoot(fs, folder) });
  });

  it('falls back to the legacy NFD-derived mirror when only that mirror exists on disk', async () => {
    const fs = new InMemoryFileSystem('/work');
    const nfdFolder = '/work/Å-ring'.normalize('NFD');
    const legacyId = legacyDerivedFolderId(nfdFolder);
    const legacyMirror = readOnlyArtifactRootById(fs, legacyId);
    fs.addDirectory(legacyMirror.path);

    const result = await discoverArtifactRoot(fs, nfdFolder);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.path).toBe(legacyMirror.path);
  });

  it('falls back to the legacy mirror when the caller passes the canonical path, as every production caller now does', async () => {
    const fs = new InMemoryFileSystem('/work');
    const legacyMirror = readOnlyArtifactRootById(fs, legacyDerivedFolderId('/work/Å-ring'.normalize('NFD')));
    fs.addDirectory(legacyMirror.path);

    const result = await discoverArtifactRoot(fs, '/work/Å-ring'.normalize('NFC'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.path).toBe(legacyMirror.path);
  });

  it('prefers the canonical mirror over the legacy one when both exist', async () => {
    const fs = new InMemoryFileSystem('/work');
    const nfdFolder = '/work/Å-ring'.normalize('NFD');
    const legacyId = legacyDerivedFolderId(nfdFolder);
    const legacyMirror = readOnlyArtifactRootById(fs, legacyId);
    fs.addDirectory(legacyMirror.path);
    const canonicalMirror = readOnlyArtifactRoot(fs, nfdFolder);
    expect(canonicalMirror.path).not.toBe(legacyMirror.path);
    fs.addDirectory(canonicalMirror.path);

    const result = await discoverArtifactRoot(fs, nfdFolder);
    expect(result).toEqual({ ok: true, value: canonicalMirror });
  });
});
