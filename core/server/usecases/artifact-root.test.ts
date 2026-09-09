import { describe, expect, it, vi } from 'vitest';

import { discoverArtifactRoot, discoverArtifactRootForWrite, folderArtifactRoot, readOnlyArtifactRoot, readOnlyArtifactRootById } from './artifact-root.js';
import { generateThumbnail } from './thumbnail.js';
import { folderMarkerPath } from './folder-identity.js';
import { InMemoryFileSystem, InMemoryMedia } from '../../../test/server/usecases/test-fakes.js';

const legacyDerivedFolderId = (folder: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < folder.length; index += 1) {
    hash = Math.imul(hash ^ folder.charCodeAt(index), 16_777_619);
  }
  return `path-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

describe('discoverArtifactRoot', () => {
  it('6hCrvVvrqp4FQV6m retains legacy-only artifacts when a merge write fails and resumes without loss', async () => {
    const fs = new InMemoryFileSystem('/work');
    const folder = '/work/Å-ring';
    const legacy = readOnlyArtifactRootById(fs, legacyDerivedFolderId(folder.normalize('NFD')));
    const canonical = readOnlyArtifactRoot(fs, folder);
    fs.addFile(`${legacy.path}/one.json`, { content: 'one' });
    fs.addFile(`${legacy.path}/two.json`, { content: 'two' });
    fs.addDirectory(canonical.path);
    const rename = vi.spyOn(fs, 'renamePath').mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'Write failed' } });
    expect(await discoverArtifactRootForWrite(fs, folder)).toMatchObject({ ok: false });
    expect(await fs.readTextFile(`${legacy.path}/one.json`)).toMatchObject({ ok: true, value: 'one' });
    expect(await fs.readTextFile(`${legacy.path}/two.json`)).toMatchObject({ ok: true, value: 'two' });
    rename.mockRestore();
    expect(await discoverArtifactRootForWrite(fs, folder)).toEqual({ ok: true, value: canonical });
    expect(await fs.exists(legacy.path)).toEqual({ ok: true, value: false });
    expect(await fs.readTextFile(`${canonical.path}/two.json`)).toMatchObject({ ok: true, value: 'two' });
  });

  it('6hCrvVvrqp4FQV6m heals the mirror when the first writer only generates a thumbnail', async () => {
    const fs = new InMemoryFileSystem('/work');
    const folder = '/work/Å-ring';
    const legacy = readOnlyArtifactRootById(fs, legacyDerivedFolderId(folder.normalize('NFD')));
    const canonical = readOnlyArtifactRoot(fs, folder);
    fs.addFile(`${folder}/clip.mp4`);
    fs.addFile(`${legacy.path}/summaries/clip.json`, { content: 'retained' });
    expect(await generateThumbnail({ fs, media: new InMemoryMedia(fs) }, { videoPath: `${folder}/clip.mp4`, force: true })).toMatchObject({ ok: true, value: { thumbnailPath: `${canonical.path}/thumbnails/clip.jpg` } });
    expect(await fs.exists(legacy.path)).toEqual({ ok: true, value: false });
    expect(await fs.readTextFile(`${canonical.path}/summaries/clip.json`)).toEqual({ ok: true, value: 'retained' });
  });

  it('returns the writable folder root when a folder marker is present', async () => {
    const fs = new InMemoryFileSystem('/work');
    const folder = '/work/videos';
    fs.addFile(folderMarkerPath(fs, folder), {
      content: JSON.stringify({ folderId: 'x', schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
    });

    const result = await discoverArtifactRoot(fs, folder);

    expect(result).toEqual({ ok: true, value: folderArtifactRoot(fs, folder) });
  });

  it('prefers the writable root over a leftover read-only mirror once the folder gained a marker', async () => {
    const fs = new InMemoryFileSystem('/work');
    const folder = '/work/videos';
    const knownFolderId = 'path-11111111';
    const staleMirror = readOnlyArtifactRootById(fs, knownFolderId);
    fs.addDirectory(staleMirror.path);
    fs.addFile(folderMarkerPath(fs, folder), {
      content: JSON.stringify({ folderId: knownFolderId, schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
    });

    const result = await discoverArtifactRoot(fs, folder, knownFolderId);

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

  it('prefers the known catalog folder id mirror over the current path-derived mirror', async () => {
    const fs = new InMemoryFileSystem('/work');
    const knownFolderId = 'path-11111111';
    const currentFolder = '/work/renamed-videos';
    const knownMirror = readOnlyArtifactRootById(fs, knownFolderId);
    const currentMirror = readOnlyArtifactRoot(fs, currentFolder);
    expect(currentMirror.path).not.toBe(knownMirror.path);
    fs.addDirectory(knownMirror.path);
    fs.addDirectory(currentMirror.path);

    const result = await discoverArtifactRoot(fs, currentFolder, knownFolderId);

    expect(result).toEqual({ ok: true, value: knownMirror });
  });

  it('keeps using the current path-derived mirror when no catalog folder id is known', async () => {
    const fs = new InMemoryFileSystem('/work');
    const currentFolder = '/work/renamed-videos';
    const unrelatedStableMirror = readOnlyArtifactRootById(fs, 'path-11111111');
    const currentMirror = readOnlyArtifactRoot(fs, currentFolder);
    expect(currentMirror.path).not.toBe(unrelatedStableMirror.path);
    fs.addDirectory(unrelatedStableMirror.path);
    fs.addDirectory(currentMirror.path);

    const result = await discoverArtifactRoot(fs, currentFolder);

    expect(result).toEqual({ ok: true, value: currentMirror });
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
