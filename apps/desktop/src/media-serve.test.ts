import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { contentTypeFor, parseRange, serveFile } from './media-serve.js';

const tempRoots: string[] = [];

const tempFile = async (name: string, bytes: Buffer): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'avc-media-serve-'));
  tempRoots.push(root);
  const filePath = path.join(root, name);
  await writeFile(filePath, bytes);
  return filePath;
};

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe('contentTypeFor', () => {
  it('maps video and image extensions and falls back to octet-stream', () => {
    expect(contentTypeFor('/a/clip.MP4')).toBe('video/mp4');
    expect(contentTypeFor('/a/clip.mov')).toBe('video/mp4');
    expect(contentTypeFor('/a/clip.webm')).toBe('video/webm');
    expect(contentTypeFor('/a/thumb.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('/a/thumb.png')).toBe('image/png');
    expect(contentTypeFor('/a/data.bin')).toBe('application/octet-stream');
  });
});

describe('parseRange', () => {
  it('parses open-ended, closed, and suffix ranges and rejects invalid ones', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-20', 100)).toEqual({ start: 10, end: 20 });
    expect(parseRange('bytes=10-500', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=-30', 100)).toEqual({ start: 70, end: 99 });
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('bytes=200-300', 100)).toBeNull();
    expect(parseRange('bytes=50-40', 100)).toBeNull();
    expect(parseRange('nonsense', 100)).toBeNull();
  });
});

describe('serveFile', () => {
  it('serves the full body with 200 and Accept-Ranges when no range is requested', async () => {
    const filePath = await tempFile('clip.mp4', Buffer.from('abcdefghij'));

    const response = await serveFile(filePath, null);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Content-Length')).toBe('10');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(await response.text()).toBe('abcdefghij');
  });

  it('serves a 206 partial body with Content-Range for a byte range', async () => {
    const filePath = await tempFile('clip.mp4', Buffer.from('abcdefghij'));

    const response = await serveFile(filePath, 'bytes=2-5');

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(await response.text()).toBe('cdef');
  });

  it('serves a tail suffix range', async () => {
    const filePath = await tempFile('clip.mp4', Buffer.from('abcdefghij'));

    const response = await serveFile(filePath, 'bytes=-3');

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 7-9/10');
    expect(await response.text()).toBe('hij');
  });

  it('returns 404 for a missing file', async () => {
    const response = await serveFile(path.join(tmpdir(), 'avc-missing-xyz.mp4'), null);

    expect(response.status).toBe(404);
  });
});
