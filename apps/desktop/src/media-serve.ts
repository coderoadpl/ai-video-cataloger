import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';


const MEDIA_CONTENT_TYPES = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/mp4'],
  ['.avi', 'video/x-msvideo'],
  ['.mkv', 'video/x-matroska'],
  ['.webm', 'video/webm'],
]);

export const contentTypeFor = (filePath: string): string =>
  MEDIA_CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';

export type RangeResult =
  | { kind: 'ok'; start: number; end: number }
  | { kind: 'unsatisfiable' }
  | { kind: 'ignore' };

export const parseRange = (header: string | null, size: number): RangeResult => {
  if (header === null) return { kind: 'ignore' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return { kind: 'ignore' };
  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (rawStart === '' && rawEnd === '') return { kind: 'ignore' };
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (Number.isNaN(suffix)) return { kind: 'ignore' };
    if (suffix === 0) return { kind: 'unsatisfiable' };
    return { kind: 'ok', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  if (Number.isNaN(start)) return { kind: 'ignore' };
  if (start >= size) return { kind: 'unsatisfiable' };
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (Number.isNaN(end) || end < start) return { kind: 'ignore' };
  return { kind: 'ok', start, end };
};

const streamBody = (filePath: string, start: number, end: number): ReadableStream<Uint8Array> => {
  const nodeStream = createReadStream(filePath, { start, end });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: string | Buffer) => {
        controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
        if (controller.desiredSize !== null && controller.desiredSize <= 0) nodeStream.pause();
      });
      nodeStream.once('end', () => controller.close());
      nodeStream.once('error', (error: Error) => controller.error(error));
    },
    pull() {
      nodeStream.resume();
    },
    cancel() {
      nodeStream.destroy();
    },
  });
};

export const serveFile = async (
  filePath: string,
  rangeHeader: string | null,
  method = 'GET',
): Promise<Response> => {
  let size: number;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return new Response(null, { status: 404 });
    size = stats.size;
  } catch {
    return new Response(null, { status: 404 });
  }

  const contentType = contentTypeFor(filePath);
  const headersOnly = method === 'HEAD';
  if (size === 0) {
    return new Response(null, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Content-Length': '0', 'Accept-Ranges': 'bytes' },
    });
  }

  const range = parseRange(rangeHeader, size);
  if (range.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Type': contentType,
        'Content-Range': `bytes */${String(size)}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  if (range.kind === 'ignore') {
    return new Response(headersOnly ? null : streamBody(filePath, 0, size - 1), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  return new Response(headersOnly ? null : streamBody(filePath, range.start, range.end), {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
      'Accept-Ranges': 'bytes',
    },
  });
};
