import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { extractTarZstd, writeTarZstd } from './tar.js';
import { scaledTimeout } from '../../test/helpers/gate-timeout.js';

const createdAt = '2026-09-02T12:34:56.000Z';

describe('deterministic tar and zstd archive', () => {
  it('round-trips a fixture tree and is byte deterministic', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-tar-'));
    const source = path.join(root, 'source');
    const extracted = path.join(root, 'extracted');
    mkdirSync(path.join(source, 'nested'), { recursive: true });
    writeFileSync(path.join(source, 'alpha.txt'), 'alpha\n');
    writeFileSync(path.join(source, 'nested', 'binary.bin'), Buffer.from([0, 1, 2, 255]));
    const entries = [
      { archivePath: 'nested/binary.bin', sourcePath: path.join(source, 'nested', 'binary.bin'), kind: 'file' },
      { archivePath: 'nested', sourcePath: path.join(source, 'nested'), kind: 'directory' },
      { archivePath: 'alpha.txt', sourcePath: path.join(source, 'alpha.txt'), kind: 'file' },
    ] as const;

    const first = await writeTarZstd(entries, path.join(root, 'first.tar.zst'), createdAt);
    const second = await writeTarZstd(entries, path.join(root, 'second.tar.zst'), createdAt);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(readFileSync(path.join(root, 'first.tar.zst'))).toEqual(readFileSync(path.join(root, 'second.tar.zst')));

    const unpacked = await extractTarZstd(path.join(root, 'first.tar.zst'), extracted);
    expect(unpacked).toMatchObject({ ok: true });
    expect(readFileSync(path.join(extracted, 'alpha.txt'), 'utf8')).toBe('alpha\n');
    expect(readFileSync(path.join(extracted, 'nested', 'binary.bin'))).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it('produces a ustar archive listable by the system tar', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-tar-list-'));
    const source = path.join(root, 'file.txt');
    writeFileSync(source, 'content');
    const archive = path.join(root, 'archive.tar.zst');
    const written = await writeTarZstd([{ archivePath: 'folder/file.txt', sourcePath: source, kind: 'file' }], archive, createdAt);
    expect(written).toMatchObject({ ok: true });

    const rawArchive = path.join(root, 'archive.tar');
    writeFileSync(rawArchive, zstdDecompressSync(readFileSync(archive)));
    const listed = execFileSync('tar', ['-tf', rawArchive], { encoding: 'utf8' });
    expect(listed.trim()).toBe('folder/file.txt');
  });

  it('keeps RSS growth bounded while streaming a 5 GB sparse input', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-tar-memory-'));
    const source = path.join(root, 'large.bin');
    writeFileSync(source, '');
    truncateSync(source, 5 * 1024 * 1024 * 1024);
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 5);
    const written = await writeTarZstd(
      [{ archivePath: 'large.bin', sourcePath: source, kind: 'file' }],
      path.join(root, 'large.tar.zst'),
      createdAt,
    );
    clearInterval(sampler);

    expect(written).toMatchObject({ ok: true });
    expect(peak - baseline).toBeLessThan(256 * 1024 * 1024);
  }, scaledTimeout(120_000));

  it.each(['path traversal', 'backslash traversal', 'absolute path', 'double slash', 'bad checksum', 'truncated archive'])('rejects %s', async (kind) => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-tar-invalid-'));
    const source = path.join(root, 'file.txt');
    const archive = path.join(root, 'archive.tar.zst');
    writeFileSync(source, 'content');
    const archivePath = kind === 'path traversal' ? '../escape.txt'
      : kind === 'backslash traversal' ? '..\\escape.txt'
        : kind === 'absolute path' ? '/escape.txt'
          : kind === 'double slash' ? 'folder//file.txt'
            : 'file.txt';
    const written = await writeTarZstd([{ archivePath, sourcePath: source, kind: 'file' }], archive, createdAt, {
      allowUnsafeArchivePath: true,
    });
    expect(written).toMatchObject({ ok: true });
    if (kind === 'bad checksum') {
      const bytes = zstdDecompressSync(readFileSync(archive));
      bytes[20] = (bytes[20] ?? 0) ^ 1;
      writeFileSync(archive, zstdCompressSync(bytes));
    }
    if (kind === 'truncated archive') {
      const bytes = readFileSync(archive);
      writeFileSync(archive, bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))));
    }

    const result = await extractTarZstd(archive, path.join(root, 'out'));
    expect(result).toMatchObject({ ok: false, error: { code: 'backup_integrity_failed' } });
  });
});
