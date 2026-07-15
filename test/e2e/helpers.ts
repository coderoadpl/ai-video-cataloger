import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { z } from 'zod';

import type { SampleSource, VideoSample } from './samples.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES_DIR = join(REPO_ROOT, 'test', 'e2e', 'fixtures');
export const CLI_DIST = process.env.E2E_CLI_DIST ?? join(REPO_ROOT, 'dist', 'cli', 'index.js');
export const ELECTRON_MAIN = process.env.E2E_ELECTRON_MAIN ?? join(REPO_ROOT, 'dist-electron', 'main.js');
export const RENDERER_HTML = process.env.E2E_RENDERER_HTML ?? join(REPO_ROOT, 'dist', 'web', 'index.html');

const jsonEventSchema = z.object({
  type: z.enum(['started', 'progress', 'completed', 'error']),
  message: z.string().optional(),
  step: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  data: z.unknown().optional(),
});

const statusOutputSchema = z.object({
  videos: z.array(z.object({
    originalName: z.string(),
    newName: z.string().nullable(),
    status: z.string(),
  })),
  summary: z.object({
    total: z.number(),
    completed: z.number(),
    inProgress: z.number(),
    pending: z.number(),
    error: z.number(),
  }),
});

const scanOutputSchema = z.object({
  videos: z.array(z.object({
    filename: z.string(),
    status: z.string(),
    artifacts: z.object({
      framePaths: z.array(z.string()).nullable(),
      transcriptPath: z.string().nullable(),
      summaryPath: z.string().nullable(),
      newFilename: z.string().nullable(),
    }),
  })),
  summary: z.object({
    total: z.number(),
    tracked: z.number(),
    completed: z.number(),
    error: z.number(),
  }),
});

export type JsonEvent = z.output<typeof jsonEventSchema>;
export type StatusOutput = z.output<typeof statusOutputSchema>;
export type ScanOutput = z.output<typeof scanOutputSchema>;

export interface CliResult {
  code: number | null;
  events: JsonEvent[];
  jsonValues: unknown[];
  stdout: string;
  stderr: string;
}

export function runCli(args: string[], cwd: string, timeoutMs = 300_000): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI_DIST, ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`CLI timed out after ${String(timeoutMs)}ms: ${args.join(' ')}\n${stdout}\n${stderr}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const jsonValues: unknown[] = [];
      const events: JsonEvent[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const parsed: unknown = JSON.parse(trimmed);
          jsonValues.push(parsed);
          const event = jsonEventSchema.safeParse(parsed);
          if (event.success) events.push(event.data);
        } catch {
          continue;
        }
      }
      resolvePromise({ code, events, jsonValues, stdout, stderr });
    });
  });
}

export function completedData(result: CliResult): unknown {
  const completed = result.events.find((event) => event.type === 'completed');
  return completed?.data;
}

export function parseStatusOutput(value: unknown): StatusOutput {
  return statusOutputSchema.parse(value);
}

export function parseScanOutput(value: unknown): ScanOutput {
  return scanOutputSchema.parse(value);
}

function sha256Of(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${String(response.status)}) for ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(response.body, createWriteStream(dest));
}

function ffmpegBinary(): string {
  const require = createRequire(import.meta.url);
  const resolved: unknown = require('ffmpeg-static');
  if (typeof resolved !== 'string' || !existsSync(resolved)) {
    throw new Error('ffmpeg-static binary not found - run npm install');
  }
  return resolved;
}

function generateSpeechVideo(dest: string, speech: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const aiff = dest.replace(/\.mp4$/, '.aiff');
  const say = spawnSync('say', ['-o', aiff, speech], { timeout: 60_000 });
  if (say.status !== 0) {
    throw new Error(`macOS 'say' failed (status ${String(say.status)}): ${String(say.stderr)}`);
  }
  const ffmpeg = spawnSync(
    ffmpegBinary(),
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=25',
      '-i',
      aiff,
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      dest,
    ],
    { timeout: 120_000 },
  );
  unlinkSync(aiff);
  if (ffmpeg.status !== 0) {
    throw new Error(`ffmpeg failed generating ${dest}: ${String(ffmpeg.stderr).slice(-2000)}`);
  }
}

export async function ensureFixture(sample: VideoSample): Promise<string> {
  const source: SampleSource = sample.source;
  if (source.kind === 'repo') {
    const path = join(REPO_ROOT, source.path);
    if (!existsSync(path)) throw new Error(`Repo fixture missing: ${path}`);
    return path;
  }

  const dest = join(FIXTURES_DIR, sample.file);
  if (source.kind === 'url') {
    if (!existsSync(dest)) await downloadTo(source.url, dest);
    const actual = sha256Of(dest);
    if (actual !== source.sha256) {
      rmSync(dest);
      throw new Error(`Checksum mismatch for ${sample.file}: expected ${source.sha256}, got ${actual}`);
    }
    return dest;
  }

  if (!existsSync(dest)) generateSpeechVideo(dest, source.speech);
  return dest;
}

export async function makeWorkdir(sample: VideoSample): Promise<{ dir: string; videoPath: string }> {
  const fixture = await ensureFixture(sample);
  const dir = join(tmpdir(), `avc-e2e-${sample.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const videoPath = join(dir, sample.file);
  copyFileSync(fixture, videoPath);
  return { dir, videoPath };
}

export interface CatalogRow {
  original_name: string;
  new_name: string | null;
  status: string;
}

export async function readCatalog(workdir: string): Promise<CatalogRow[]> {
  const dbPath = join(workdir, '.ai-video-cataloger', 'catalog.db');
  if (!existsSync(dbPath)) throw new Error(`catalog.db not found in ${workdir}`);
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const result = db.exec('SELECT original_name, new_name, status FROM videos');
    if (result.length === 0) return [];
    const table = result[0];
    if (table === undefined) return [];
    return table.values.map((row) => ({
      original_name: String(row[0]),
      new_name: row[1] === null ? null : String(row[1]),
      status: String(row[2]),
    }));
  } finally {
    db.close();
  }
}

export async function revertRenames(workdir: string): Promise<number> {
  const rows = await readCatalog(workdir);
  let reverted = 0;
  for (const row of rows) {
    if (!row.new_name || row.new_name === row.original_name) continue;
    const from = join(workdir, row.new_name);
    const to = join(workdir, row.original_name);
    if (existsSync(from)) {
      renameSync(from, to);
      reverted += 1;
    }
  }
  return reverted;
}

export function listVideos(dir: string): string[] {
  const extensions = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
  return readdirSync(dir).filter((name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 && extensions.has(name.slice(dot).toLowerCase());
  }).sort();
}

export function findKeyword(haystack: string, keywords: string[]): string | null {
  const lower = haystack.toLowerCase();
  return keywords.find((keyword) => lower.includes(keyword.toLowerCase())) ?? null;
}

export function makeEmptyWorkdir(tag: string): string {
  const dir = join(tmpdir(), `avc-e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function addSampleTo(dir: string, sample: VideoSample): Promise<string> {
  const fixture = await ensureFixture(sample);
  copyFileSync(fixture, join(dir, sample.file));
  return sample.file;
}

export function addCorruptVideoTo(dir: string, name = 'corrupt-video.mp4'): string {
  const garbage = Buffer.alloc(256 * 1024);
  garbage.fill('THIS IS NOT A REAL MP4 FILE. ');
  writeFileSync(join(dir, name), garbage);
  return name;
}

export async function createOldDataCompatFixture(dir: string): Promise<string> {
  const originalName = 'legacy-resume.mp4';
  const originalPath = join(dir, originalName);
  const baseName = 'legacy-resume';
  writeFileSync(originalPath, Buffer.from('legacy placeholder video'));

  mkdirSync(join(dir, 'frames', baseName), { recursive: true });
  mkdirSync(join(dir, 'transcripts'), { recursive: true });
  writeFileSync(join(dir, 'frames', baseName, 'frame-001.jpg'), legacyJpeg());
  writeFileSync(
    join(dir, 'transcripts', `${baseName}.txt`),
    'A legacy compatibility clip about pasta, tomato sauce, and a kitchen workflow.',
    'utf8',
  );

  const dbDir = join(dir, '.ai-video-cataloger');
  mkdirSync(dbDir, { recursive: true });
  writeFileSync(join(dbDir, 'config.json'), JSON.stringify({ frames: '1', whisper_mode: 'skip' }, null, 2), 'utf8');

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const statement of oldSchemaStatements()) db.run(statement);
  db.run(
    `INSERT INTO videos (
      original_path,
      original_name,
      new_name,
      file_hash,
      status,
      created_at,
      updated_at,
      error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      originalPath,
      originalName,
      null,
      'legacy-hash',
      'error',
      '2026-07-12 10:11:12',
      '2026-07-12 10:12:13',
      'Legacy interrupted run',
    ],
  );
  writeFileSync(join(dbDir, 'catalog.db'), Buffer.from(db.export()));
  db.close();
  return originalName;
}

function oldSchemaStatements(): string[] {
  const source = readFileSync(join(FIXTURES_DIR, 'old-schema.sql'), 'utf8');
  const statements = source
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  if (statements.length !== 2) throw new Error(`Expected 2 old schema statements, found ${String(statements.length)}`);
  return statements;
}

function legacyJpeg(): Buffer {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYwLjMuMTAwAP/bAEMACAoKCwoLDQ0NDQ0NEA8QEBAQEBAQEBAQEBISEhUVFRISEhAQEhIUFBUVFxcXFRUVFRcXGRkZHh4cHCMjJCsrM//EAEoAAQAAAAAAAAAAAAAAAAAAAAABAQAAAAAAAAAAAAAAAAAAAAAQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCABAAEADASIAAhEAAxEA/9oADAMBAAIRAxEAPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2Q==',
    'base64',
  );
}
