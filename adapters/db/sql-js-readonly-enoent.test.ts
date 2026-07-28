import { accessSync, constants, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FileSystemModule = Record<string, unknown> & {
  accessSync: typeof accessSync;
  mkdirSync: typeof mkdirSync;
};

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<FileSystemModule>();
  return {
    ...actual,
    accessSync: vi.fn(actual.accessSync),
    mkdirSync: vi.fn(actual.mkdirSync),
  };
});

import { SqlJsCatalogRepositoryFactory } from './sql-js.js';

const roots: string[] = [];
const mockedAccessSync = vi.mocked(accessSync);
const mockedMkdirSync = vi.mocked(mkdirSync);

describe('SqlJsCatalogRepositoryFactory masked read-only errors', () => {
  beforeEach(() => {
    mockedAccessSync.mockClear();
    mockedMkdirSync.mockClear();
  });

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('opens index-only when ENOENT masks a write rejection on the nearest existing ancestor', async () => {
    const folder = await tempRoot();
    mockedMkdirSync.mockImplementationOnce(() => {
      throw errno('ENOENT');
    });
    mockedAccessSync.mockImplementationOnce((target, mode) => {
      expect(target).toBe(folder);
      expect(mode).toBe(constants.W_OK);
      throw errno('EROFS');
    });

    const opened = await new SqlJsCatalogRepositoryFactory().open(folder);

    expect(opened.ok).toBe(true);
    expect(opened.ok && opened.value.writable()).toBe(false);
  });

  it('keeps genuine ENOENT on a writable tree as an internal error', async () => {
    const folder = await tempRoot();
    mockedMkdirSync.mockImplementationOnce(() => {
      throw errno('ENOENT');
    });

    const opened = await new SqlJsCatalogRepositoryFactory().open(folder);

    expect(opened).toMatchObject({ ok: false, error: { code: 'internal', details: { code: 'ENOENT' } } });
  });

  it('keeps plain EROFS classified as read-only', async () => {
    const folder = await tempRoot();
    mockedMkdirSync.mockImplementationOnce(() => {
      throw errno('EROFS');
    });

    const opened = await new SqlJsCatalogRepositoryFactory().open(folder);

    expect(opened.ok).toBe(true);
    expect(opened.ok && opened.value.writable()).toBe(false);
    expect(mockedAccessSync).not.toHaveBeenCalled();
  });
});

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-db-masked-ro-'));
  roots.push(root);
  return root;
};

const errno = (code: string): Error & { code: string } => Object.assign(new Error(code), { code });
