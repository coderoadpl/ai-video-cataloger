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

export const parseRange = (
  header: string | null,
  size: number,
): { start: number; end: number } | null => {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (rawStart === '' && rawEnd === '') return null;
  const start = rawStart === '' ? size - Number(rawEnd) : Number(rawStart);
  const end = rawEnd === '' || rawStart === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || start >= size) return null;
  return { start, end };
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

export const serveFile = async (filePath: string, rangeHeader: string | null): Promise<Response> => {
  let size: number;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return new Response(null, { status: 404 });
    size = stats.size;
  } catch {
    return new Response(null, { status: 404 });
  }

  const contentType = contentTypeFor(filePath);
  if (size === 0) {
    return new Response(null, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Content-Length': '0', 'Accept-Ranges': 'bytes' },
    });
  }

  const range = parseRange(rangeHeader, size);
  if (range === null) {
    return new Response(streamBody(filePath, 0, size - 1), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  return new Response(streamBody(filePath, range.start, range.end), {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
      'Accept-Ranges': 'bytes',
    },
  });
};
