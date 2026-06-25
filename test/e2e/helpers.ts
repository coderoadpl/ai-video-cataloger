/**
 * E2E helpers: fixture provisioning, black-box CLI runner, catalog reader and
 * rename reversal.
 *
 * The suite is deliberately decoupled from the checkout under test: the CLI
 * binary is taken from E2E_CLI_DIST (defaults to this repo's dist/index.js),
 * so the same tests can run against main, this branch, or any PR build - see
 * scripts/e2e-videos.sh.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync,
  readFileSync, renameSync, rmSync, unlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import type { SampleSource, VideoSample } from './samples.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES_DIR = join(REPO_ROOT, 'test', 'e2e', 'fixtures');
export const CLI_DIST = process.env.E2E_CLI_DIST ?? join(REPO_ROOT, 'dist', 'index.js');

export interface JsonEvent {
  type: 'started' | 'progress' | 'completed' | 'error';
  message?: string;
  step?: string;
  error?: string;
  code?: string;
  data?: Record<string, unknown>;
}

export interface CliResult {
  code: number | null;
  events: JsonEvent[];
  stdout: string;
  stderr: string;
}

/** Run the CLI under test as a black box and collect its NDJSON events. */
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
      rejectPromise(new Error(`CLI timed out after ${timeoutMs}ms: ${args.join(' ')}\n${stdout}\n${stderr}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); rejectPromise(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const events: JsonEvent[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(trimmed) as JsonEvent;
          if (parsed && typeof parsed === 'object' && 'type' in parsed) events.push(parsed);
        } catch { /* non-JSON stdout line */ }
      }
      resolvePromise({ code, events, stdout, stderr });
    });
  });
}

function sha256Of(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(dest));
}

function ffmpegBinary(): string {
  // The repo bundles ffmpeg via ffmpeg-static; resolve it from the suite's repo
  // (not the checkout under test) so fixture generation never depends on the ref.
  const require = createRequire(import.meta.url);
  const bin = require('ffmpeg-static') as unknown as string | null;
  if (!bin || !existsSync(bin)) throw new Error('ffmpeg-static binary not found - run npm install');
  return bin;
}

function generateSpeechVideo(dest: string, speech: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const aiff = dest.replace(/\.mp4$/, '.aiff');
  const say = spawnSync('say', ['-o', aiff, speech], { timeout: 60_000 });
  if (say.status !== 0) {
    throw new Error(`macOS 'say' failed (status ${say.status}): ${say.stderr?.toString()}`);
  }
  const ffmpeg = spawnSync(
    ffmpegBinary(),
    [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25',
      '-i', aiff,
      '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      dest,
    ],
    { timeout: 120_000 }
  );
  unlinkSync(aiff);
  if (ffmpeg.status !== 0) {
    throw new Error(`ffmpeg failed generating ${dest}: ${ffmpeg.stderr?.toString().slice(-2000)}`);
  }
}

/** Make sure a sample's fixture file exists locally; return its absolute path. */
export async function ensureFixture(sample: VideoSample): Promise<string> {
  const source: SampleSource = sample.source;
  if (source.kind === 'repo') {
    const path = join(REPO_ROOT, source.path);
    if (!existsSync(path)) throw new Error(`Repo fixture missing: ${path}`);
    return path;
  }

  const dest = join(FIXTURES_DIR, sample.file);
  if (source.kind === 'url') {
    if (!existsSync(dest)) {
      await downloadTo(source.url, dest);
    }
    const actual = sha256Of(dest);
    if (actual !== source.sha256) {
      rmSync(dest);
      throw new Error(
        `Checksum mismatch for ${sample.file}: expected ${source.sha256}, got ${actual} (file removed - rerun)`
      );
    }
    return dest;
  }

  // synthetic
  if (!existsSync(dest)) {
    generateSpeechVideo(dest, source.speech);
  }
  return dest;
}

/** Create an isolated working dir with a copy of the sample video inside. */
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

/** Read the per-folder catalog the CLI wrote (schema is stable across branches). */
export async function readCatalog(workdir: string): Promise<CatalogRow[]> {
  const dbPath = join(workdir, '.ai-video-cataloger', 'catalog.db');
  if (!existsSync(dbPath)) throw new Error(`catalog.db not found in ${workdir}`);
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const result = db.exec('SELECT original_name, new_name, status FROM videos');
    if (result.length === 0) return [];
    return result[0].values.map((row) => ({
      original_name: String(row[0]),
      new_name: row[1] === null ? null : String(row[1]),
      status: String(row[2]),
    }));
  } finally {
    db.close();
  }
}

/**
 * Reverse the renames the tool performed, using only its own catalog - this
 * proves the operation is recoverable from the data the tool persists.
 * Returns the number of files renamed back.
 */
export async function revertRenames(workdir: string): Promise<number> {
  const rows = await readCatalog(workdir);
  let reverted = 0;
  for (const row of rows) {
    if (!row.new_name || row.new_name === row.original_name) continue;
    const from = join(workdir, row.new_name);
    const to = join(workdir, row.original_name);
    if (existsSync(from)) {
      renameSync(from, to);
      reverted++;
    }
  }
  return reverted;
}

/** List video files (by extension) directly inside a dir. */
export function listVideos(dir: string): string[] {
  const extensions = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
  return readdirSync(dir).filter((name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 && extensions.has(name.slice(dot).toLowerCase());
  }).sort();
}

export interface Prereqs {
  claude: boolean;
  whisper: boolean;
  say: boolean;
}

export function detectPrereqs(): Prereqs {
  const has = (cmd: string, args: string[]): boolean =>
    spawnSync(cmd, args, { timeout: 20_000, stdio: 'ignore' }).status === 0;
  return {
    claude: has('claude', ['--version']),
    whisper: has('which', ['whisper']),
    say: process.platform === 'darwin' && has('which', ['say']),
  };
}

export function findKeyword(haystack: string, keywords: string[]): string | null {
  const lower = haystack.toLowerCase();
  return keywords.find((keyword) => lower.includes(keyword.toLowerCase())) ?? null;
}
