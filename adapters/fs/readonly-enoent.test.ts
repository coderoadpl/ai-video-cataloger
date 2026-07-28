import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FileSystemPromisesModule = Record<string, unknown> & {
  access: typeof access;
  mkdir: typeof mkdir;
};

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<FileSystemPromisesModule>();
  return {
    ...actual,
    access: vi.fn(actual.access),
    mkdir: vi.fn(actual.mkdir),
  };
});

import { NodeFileSystemPort } from './index.js';

const roots: string[] = [];
const mockedAccess = vi.mocked(access);
const mockedMkdir = vi.mocked(mkdir);

describe('NodeFileSystemPort masked read-only errors', () => {
  beforeEach(() => {
    mockedAccess.mockClear();
    mockedMkdir.mockClear();
  });

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('carries the nearest ancestor write rejection when mkdir reports ENOENT', async () => {
    const root = await tempRoot();
    const target = path.join(root, 'missing', 'sidecar');
    mockedMkdir.mockRejectedValueOnce(errno('ENOENT'));
    mockedAccess
      .mockRejectedValueOnce(errno('ENOENT'))
      .mockRejectedValueOnce(errno('ENOENT'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(errno('EROFS'));

    const created = await new NodeFileSystemPort().ensureDirectory(target);

    expect(created).toMatchObject({ ok: false, error: { code: 'internal', details: { code: 'EROFS' } } });
    expect(mockedAccess).toHaveBeenLastCalledWith(root, constants.W_OK);
  });

  it('keeps genuine ENOENT on a writable tree as an internal error', async () => {
    const root = await tempRoot();
    const target = path.join(root, 'missing', 'sidecar');
    mockedMkdir.mockRejectedValueOnce(errno('ENOENT'));
    mockedAccess
      .mockRejectedValueOnce(errno('ENOENT'))
      .mockRejectedValueOnce(errno('ENOENT'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const created = await new NodeFileSystemPort().ensureDirectory(target);

    expect(created).toMatchObject({ ok: false, error: { code: 'internal', details: { code: 'ENOENT' } } });
    expect(mockedAccess).toHaveBeenLastCalledWith(root, constants.W_OK);
  });

  it('keeps plain EROFS as the mkdir failure cause', async () => {
    const target = path.join(await tempRoot(), 'sidecar');
    mockedMkdir.mockRejectedValueOnce(errno('EROFS'));

    const created = await new NodeFileSystemPort().ensureDirectory(target);

    expect(created).toMatchObject({ ok: false, error: { code: 'internal', details: { code: 'EROFS' } } });
    expect(mockedAccess).not.toHaveBeenCalled();
  });
});

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-fs-masked-ro-'));
  roots.push(root);
  return root;
};

const errno = (code: string): Error & { code: string } => Object.assign(new Error(code), { code });
