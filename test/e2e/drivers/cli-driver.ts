import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { analyzerCliFlags } from '../analyzer-mode.js';
import { CLI_DIST, cliEnv, listVideos, runCli, type JsonEvent } from '../helpers.js';
import type { AnalyzeOptions, AnalyzeOutcome, BatchOutcome, PipelineDriver } from './types.js';

const PIPELINE_TIMEOUT_MS = 420_000;

export class CliDriver implements PipelineDriver {
  readonly kind = 'cli' as const;
  private workdir = '';

  async open(workdir: string): Promise<void> {
    this.workdir = workdir;
  }

  async analyze(filename: string, options: AnalyzeOptions): Promise<AnalyzeOutcome> {
    const result = await runCli(
      ['process', join(this.workdir, filename), '--json', '--whisper', options.whisper, ...analyzerCliFlags()],
      this.workdir,
      PIPELINE_TIMEOUT_MS,
    );
    const errors = result.events
      .filter((event) => event.type === 'error')
      .map((event) => event.error ?? event.message ?? 'unknown error');
    const completed = result.events.some((event) => event.type === 'completed');
    return { ok: result.code === 0 && errors.length === 0 && completed, errors };
  }

  async analyzeAndCancel(filename: string, afterMs: number, options: AnalyzeOptions): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(
        process.execPath,
        [CLI_DIST, 'process', join(this.workdir, filename), '--json', '--whisper', options.whisper, ...analyzerCliFlags()],
        { cwd: this.workdir, env: cliEnv(this.workdir), stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let buffered = '';
      let killScheduled = false;
      const hardTimer = setTimeout(() => {
        child.kill('SIGKILL');
        rejectPromise(new Error('analyzeAndCancel: pipeline did not stop within the hard timeout'));
      }, 120_000);

      child.stdout.on('data', (chunk: Buffer) => {
        buffered += chunk.toString();
        if (killScheduled) return;
        for (const line of buffered.split('\n')) {
          const event = parseJsonEvent(line);
          if (event?.type === 'progress') {
            killScheduled = true;
            setTimeout(() => {
              child.kill('SIGTERM');
            }, afterMs);
            break;
          }
        }
      });
      child.on('error', (error) => {
        clearTimeout(hardTimer);
        rejectPromise(error);
      });
      child.on('close', () => {
        clearTimeout(hardTimer);
        resolvePromise();
      });
    });
  }

  async analyzeAll(options: AnalyzeOptions): Promise<BatchOutcome> {
    const files = listVideos(this.workdir);
    let success = 0;
    let failed = 0;
    for (const file of files) {
      const outcome = await this.analyze(file, options);
      if (outcome.ok) success += 1;
      else failed += 1;
    }
    return { success, failed };
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}

function parseJsonEvent(line: string): JsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) return null;
    const type = parsed.type;
    if (type !== 'started' && type !== 'progress' && type !== 'completed' && type !== 'error') return null;
    return {
      type,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      step: typeof parsed.step === 'string' ? parsed.step : undefined,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      code: typeof parsed.code === 'string' ? parsed.code : undefined,
      data: 'data' in parsed ? parsed.data : undefined,
    };
  } catch {
    return null;
  }
}
