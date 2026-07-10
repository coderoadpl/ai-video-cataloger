/**
 * CLI driver: runs the pipeline exactly the way a terminal user (or the GUI's
 * spawner) does - `process <file> --json` per video, defaults untouched so the
 * behavior matches the GUI spawn (`spawnCLIWithJson` inserts --json the same
 * way). Batch is a sequential loop that continues past failures, mirroring
 * the GUI batch queue.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { CLI_DIST, listVideos, runCli, type JsonEvent } from '../helpers.js';
import { analyzerCliFlags } from '../analyzer-mode.js';
import type { AnalyzeOutcome, BatchOutcome, PipelineDriver } from './types.js';

const PIPELINE_TIMEOUT_MS = 420_000;

export class CliDriver implements PipelineDriver {
  readonly kind = 'cli' as const;
  private workdir = '';

  async open(workdir: string): Promise<void> {
    this.workdir = workdir;
  }

  async analyze(filename: string): Promise<AnalyzeOutcome> {
    const result = await runCli(
      ['process', join(this.workdir, filename), '--json', ...analyzerCliFlags()],
      this.workdir,
      PIPELINE_TIMEOUT_MS
    );
    const errors = result.events
      .filter((event) => event.type === 'error')
      .map((event) => event.error ?? event.message ?? 'unknown error');
    const completed = result.events.some((event) => event.type === 'completed');
    return { ok: result.code === 0 && errors.length === 0 && completed, errors };
  }

  async analyzeAndCancel(filename: string, afterMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [CLI_DIST, 'process', join(this.workdir, filename), '--json', ...analyzerCliFlags()],
        { cwd: this.workdir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
      );

      let buffered = '';
      let killScheduled = false;
      const hardTimer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('analyzeAndCancel: pipeline did not stop within the hard timeout'));
      }, 120_000);

      child.stdout.on('data', (chunk: Buffer) => {
        buffered += chunk.toString();
        if (killScheduled) return;
        // Cancel once processing has visibly started (first progress event),
        // matching the GUI flow where Cancel appears with the progress panel.
        for (const line of buffered.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            const event = JSON.parse(trimmed) as JsonEvent;
            if (event.type === 'progress') {
              killScheduled = true;
              setTimeout(() => child.kill('SIGTERM'), afterMs);
              break;
            }
          } catch { /* partial line */ }
        }
      });
      child.on('error', (error) => { clearTimeout(hardTimer); reject(error); });
      child.on('close', () => { clearTimeout(hardTimer); resolve(); });
    });
  }

  async analyzeAll(): Promise<BatchOutcome> {
    // Snapshot the file list first - successful runs rename files as we go.
    const files = listVideos(this.workdir);
    let success = 0;
    let failed = 0;
    for (const file of files) {
      const outcome = await this.analyze(file);
      if (outcome.ok) success++;
      else failed++;
    }
    return { success, failed };
  }

  async close(): Promise<void> {
    // nothing to clean up - each analyze call is a self-contained process
  }
}
