/**
 * Black-box tests for the local AI model commands (no network, no pulls).
 */

import { describe, it, expect } from 'vitest';
import { runCli, parseJsonEvents } from '../helpers/cli-runner.js';

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
    const completed = events.find((event) => event.type === 'completed');
    expect(completed).toBeDefined();
    const data = completed!.data as {
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
  }, 30_000);

  it('prints a human table with the machine line', async () => {
    const result = await runCli(['models', 'requirements']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Your machine:');
    expect(result.stdout).toContain('gemma3:12b');
  }, 30_000);
});

describe('models list (local AI section)', () => {
  it('exits quickly and cleanly even when nothing is running', async () => {
    const start = Date.now();
    const result = await runCli(['models', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Local AI models');
    // Runtime probing must not hang (1s probe timeouts)
    expect(Date.now() - start).toBeLessThan(15_000);
  }, 30_000);
});

describe('models pull validation', () => {
  it('rejects a tier that exceeds this machine instead of downloading', async () => {
    // gemma3:27b needs 32GB; on machines with more RAM this test would pull,
    // so only assert the blocking path when the machine cannot run it.
    const req = await runCli(['models', 'requirements', '--json']);
    const completed = parseJsonEvents(req.stdout).find((event) => event.type === 'completed');
    const data = completed!.data as { tiers: TierView[] };
    const big = data.tiers.find((tier) => tier.tag === 'gemma3:27b');

    if (big && big.supportLevel !== 'ok') {
      const result = await runCli(['models', 'pull', 'gemma3:27b', '--json']);
      expect(result.exitCode).toBeGreaterThan(0);
      const error = parseJsonEvents(result.stdout).find((event) => event.type === 'error');
      expect(error?.code).toBe('HW_REQUIREMENTS_NOT_MET');
    }
  }, 30_000);
});
