/**
 * Black-box tests for the local AI model commands (no network, no pulls).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { runCli, parseJsonEvents } from '../helpers/cli-runner.js';
import { scaledTimeout } from '../helpers/gate-timeout.js';

interface TierView {
  tag: string;
  supportLevel: string;
  installed: boolean;
  minTotalMemGB: number;
}

describe('models requirements', () => {
  it('emits machine info and all tiers with support levels (--json)', async () => {
    const result = await runCli(['models', 'requirements', '--json']);
    expect(result.exitCode).toBe(0);

    const events = parseJsonEvents(result.stdout);
    const started = events.find((event) => event.type === 'started');
    const completed = events.find((event) => event.type === 'completed');
    expect(started?.data).toEqual({});
    if (completed === undefined) throw new Error('CLI did not emit a completed event');
    const data = completed.data as {
      machine: { totalMemGB: number; appleSilicon: boolean };
      tiers: TierView[];
    };
    expect(data.machine.totalMemGB).toBeGreaterThan(0);
    expect(data.tiers.map((tier) => tier.tag)).toEqual(
      expect.arrayContaining(['gemma3:4b', 'gemma3:12b', 'gemma3:27b', 'qwen2.5vl:7b'])
    );
    for (const tier of data.tiers) {
      expect(['ok', 'insufficient-ram', 'unsupported-platform']).toContain(tier.supportLevel);
      expect(typeof tier.installed).toBe('boolean');
    }
  }, scaledTimeout(30_000));

  it('prints a human table with the machine line', async () => {
    const result = await runCli(['models', 'requirements']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Your machine:');
    expect(result.stdout).toContain('gemma3:12b');
  }, scaledTimeout(30_000));
});

describe('models list (local AI section)', () => {
  it('exits quickly and cleanly even when nothing is running', async () => {
    const start = Date.now();
    const result = await runCli(['models', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Local AI models');
    expect(result.stdout).toContain('gemma3:12b');
    expect(result.stdout).toMatch(/installed|not installed/);
    expect(result.stdout).toMatch(/compatible|not enough RAM|Apple Silicon required/);
    // Runtime probing must not hang (1s probe timeouts)
    expect(Date.now() - start).toBeLessThan(15_000);
  }, scaledTimeout(30_000));
});

describe('models pull validation', () => {
  it('rejects a tier that exceeds this machine instead of downloading', async () => {
    // gemma3:27b needs 32GB; on machines with more RAM this test would pull,
    // so only assert the blocking path when the machine cannot run it.
    const req = await runCli(['models', 'requirements', '--json']);
    const completed = parseJsonEvents(req.stdout).find((event) => event.type === 'completed');
    if (completed === undefined) throw new Error('CLI did not emit a completed event');
    const data = completed.data as { tiers: TierView[] };
    const big = data.tiers.find((tier) => tier.tag === 'gemma3:27b');

    if (big && big.supportLevel !== 'ok') {
      const result = await runCli(['models', 'pull', 'gemma3:27b', '--json']);
      expect(result.exitCode).toBeGreaterThan(0);
      const error = parseJsonEvents(result.stdout).find((event) => event.type === 'error');
      expect(error?.code).toBe('HW_REQUIREMENTS_NOT_MET');
    }
  }, scaledTimeout(30_000));
});

describe('managed daemon lifetime', () => {
  it('survives CLI disposal and stops only through daemon-stop', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'avc-cli-daemon-'));
    const statePath = path.join(home, '.ai-video-cataloger', 'ollama-runtime.json');
    const binPath = path.join(home, 'bin');
    const psPath = path.join(binPath, 'ps');
    const daemon = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const pid = daemon.pid;
    if (pid === undefined) throw new Error('Expected daemon pid');
    const exited = new Promise<void>((resolve) => daemon.once('exit', () => resolve()));
    try {
      await mkdir(binPath, { recursive: true });
      await writeFile(psPath, '#!/bin/sh\nprintf \'%s\\n\' "$AVC_FAKE_PROCESS_COMMAND"\n', 'utf8');
      await chmod(psPath, 0o755);
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify({
        port: 9786,
        pid,
        version: 'v0.31.1',
        binaryPath: process.execPath,
      }), 'utf8');

      const env = {
        HOME: home,
        PATH: `${binPath}:${process.env.PATH ?? ''}`,
        AVC_FAKE_PROCESS_COMMAND: `${process.execPath} -e managed`,
      };
      const health = await runCli(['health', '--json'], { env });

      expect(health.exitCode).toBe(0);
      expect(existsSync(statePath)).toBe(true);
      expect(daemon.exitCode).toBeNull();

      const stopped = await runCli(['models', 'daemon-stop', '--json'], { env });
      await exited;

      expect(stopped.exitCode).toBe(0);
      expect(parseJsonEvents(stopped.stdout).find((event) => event.type === 'completed')?.data).toEqual({ stopped: true });
      expect(existsSync(statePath)).toBe(false);
      expect(daemon.signalCode).toBe('SIGTERM');
    } finally {
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGTERM');
      await rm(home, { recursive: true, force: true });
    }
  }, scaledTimeout(30_000));
});
