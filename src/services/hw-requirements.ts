/**
 * Hardware requirements for local AI models, evaluated against the detected
 * machine (unified-memory Apple Silicon assumptions). Pure functions so the
 * matrix is unit-testable; consumed by doctor, models CLI and the GUI.
 */

import { arch as osArch, platform as osPlatform, totalmem } from 'node:os';

export interface ModelTier {
  /** Ollama model tag, e.g. gemma3:12b */
  tag: string;
  label: string;
  downloadGB: number;
  /** Approx peak unified memory during inference. */
  runRamGB: number;
  /** Minimum total machine RAM for a sensible experience. */
  minTotalMemGB: number;
  recommendedDefault?: boolean;
}

export const MODEL_TIERS: ModelTier[] = [
  { tag: 'gemma3:4b', label: 'Gemma 3 4B (compact)', downloadGB: 3.3, runRamGB: 6, minTotalMemGB: 8 },
  { tag: 'gemma3:12b', label: 'Gemma 3 12B (standard)', downloadGB: 8.1, runRamGB: 11, minTotalMemGB: 16, recommendedDefault: true },
  { tag: 'gemma3:27b', label: 'Gemma 3 27B (max)', downloadGB: 17, runRamGB: 22, minTotalMemGB: 32 },
  { tag: 'qwen2.5vl:7b', label: 'Qwen 2.5 VL 7B (alt vision)', downloadGB: 6.0, runRamGB: 9, minTotalMemGB: 16 },
];

export interface MachineInfo {
  platform: string;
  arch: string;
  totalMemGB: number;
  appleSilicon: boolean;
}

export type SupportLevel = 'ok' | 'insufficient-ram' | 'unsupported-platform';

export function getMachine(): MachineInfo {
  const platform = osPlatform();
  const arch = osArch();
  return {
    platform,
    arch,
    totalMemGB: Math.round(totalmem() / 1024 ** 3),
    appleSilicon: platform === 'darwin' && arch === 'arm64',
  };
}

/**
 * Whether a tier makes sense on this machine. Local AI is Apple Silicon only:
 * CPU-only inference on Intel Macs is impractically slow for these models.
 */
export function supportLevel(tier: ModelTier, machine: MachineInfo): SupportLevel {
  if (!machine.appleSilicon) {
    return 'unsupported-platform';
  }
  if (machine.totalMemGB < tier.minTotalMemGB) {
    return 'insufficient-ram';
  }
  return 'ok';
}

/** Best tier for this machine: the largest supported one marked sensible. */
export function recommendTier(machine: MachineInfo): ModelTier | null {
  if (!machine.appleSilicon) return null;
  const supported = MODEL_TIERS.filter(
    (tier) => supportLevel(tier, machine) === 'ok'
  );
  if (supported.length === 0) return null;
  // Prefer the recommended default when it runs; otherwise the biggest gemma tier
  const preferred = supported.find((tier) => tier.recommendedDefault);
  if (preferred) return preferred;
  return supported.reduce((best, tier) =>
    tier.minTotalMemGB > best.minTotalMemGB ? tier : best
  );
}

export function describeMachine(machine: MachineInfo): string {
  const chip = machine.appleSilicon
    ? 'Apple Silicon'
    : `${machine.platform}/${machine.arch}`;
  return `${chip}, ${machine.totalMemGB} GB RAM`;
}
