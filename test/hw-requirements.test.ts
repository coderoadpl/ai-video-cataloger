/**
 * Unit tests for the hardware requirements matrix (pure functions).
 */

import { describe, it, expect } from 'vitest';
import {
  MODEL_TIERS, recommendTier, supportLevel, type MachineInfo,
} from '../src/services/hw-requirements.js';

const mac = (totalMemGB: number, appleSilicon = true): MachineInfo => ({
  platform: 'darwin',
  arch: appleSilicon ? 'arm64' : 'x64',
  totalMemGB,
  appleSilicon,
});

const tier = (tag: string) => {
  const found = MODEL_TIERS.find((t) => t.tag === tag);
  if (!found) throw new Error(`missing tier ${tag}`);
  return found;
};

describe('hw-requirements', () => {
  it('matches the published tier matrix', () => {
    expect(tier('gemma3:4b').minTotalMemGB).toBe(8);
    expect(tier('gemma3:12b').minTotalMemGB).toBe(16);
    expect(tier('gemma3:27b').minTotalMemGB).toBe(32);
    expect(tier('qwen2.5vl:7b').minTotalMemGB).toBe(16);
    expect(tier('gemma3:12b').recommendedDefault).toBe(true);
  });

  it('8GB Apple Silicon runs only the compact tier', () => {
    const machine = mac(8);
    expect(supportLevel(tier('gemma3:4b'), machine)).toBe('ok');
    expect(supportLevel(tier('gemma3:12b'), machine)).toBe('insufficient-ram');
    expect(recommendTier(machine)?.tag).toBe('gemma3:4b');
  });

  it('16GB Apple Silicon recommends the standard tier', () => {
    const machine = mac(16);
    expect(supportLevel(tier('gemma3:12b'), machine)).toBe('ok');
    expect(supportLevel(tier('gemma3:27b'), machine)).toBe('insufficient-ram');
    expect(recommendTier(machine)?.tag).toBe('gemma3:12b');
  });

  it('32GB Apple Silicon supports everything, still recommends the default', () => {
    const machine = mac(32);
    for (const t of MODEL_TIERS) {
      expect(supportLevel(t, machine)).toBe('ok');
    }
    expect(recommendTier(machine)?.tag).toBe('gemma3:12b');
  });

  it('Intel Macs are unsupported regardless of RAM', () => {
    const machine = mac(64, false);
    for (const t of MODEL_TIERS) {
      expect(supportLevel(t, machine)).toBe('unsupported-platform');
    }
    expect(recommendTier(machine)).toBeNull();
  });
});
