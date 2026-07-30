import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeFileSystemPort } from './fs/index.js';
import { ExifrExifAdapter } from './exif/index.js';
import { runPhotoScan, type PhotosDeps } from '../core/server/usecases/photos.js';
import {
  FakePhotoMediaPort,
  InMemoryAnalyzer,
  InMemoryConfig,
  InMemoryJobs,
  InMemoryPhotosStore,
} from '../test/server/usecases/test-fakes.js';

describe('runPhotoScan read-only root invariant', () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop();
      if (root === undefined) continue;
      chmodSync(root, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never writes under a read-only photo folder', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-ro-photos-'));
    roots.push(root);
    writeFileSync(path.join(root, 'a.jpg'), 'a');
    writeFileSync(path.join(root, 'b.jpg'), 'b');
    const before = readdirSync(root).sort().map((name) => ({ name, mtimeMs: statSync(path.join(root, name)).mtimeMs }));
    chmodSync(root, 0o555);

    const deps: PhotosDeps = {
      photos: new InMemoryPhotosStore(),
      fs: new NodeFileSystemPort(),
      exif: new ExifrExifAdapter(),
      photoMedia: new FakePhotoMediaPort(),
      jobs: new InMemoryJobs(),
      config: new InMemoryConfig(),
      analyzer: new InMemoryAnalyzer(),
    };
    const result = await runPhotoScan(deps, { root });

    expect(result.ok).toBe(true);
    const after = readdirSync(root).sort().map((name) => ({ name, mtimeMs: statSync(path.join(root, name)).mtimeMs }));
    expect(after).toEqual(before);
  });
});
