import {
  LOCAL_AI_HARDWARE_TIERS,
  getLocalAiSupportLevel,
  ok,
  type AppError,
  type MachineProfile,
  type Result,
} from '@core/domain/index.js';

import type { AnalyzerPort, DependencyStatus, LocalAiRuntimePort, MediaPort, TranscriberPort } from '../ports.js';

export interface DoctorDeps {
  media: MediaPort;
  transcriber: TranscriberPort;
  analyzer: AnalyzerPort;
  localAi: LocalAiRuntimePort;
}

export interface DoctorOutput {
  dependencies: DependencyStatus[];
  machine: {
    platform: string;
    arch: string;
    totalMemGB: number;
    appleSilicon: boolean;
  };
  recommendedLocalModel: string | null;
  allAvailable: boolean;
}

export const runDoctor = async (deps: DoctorDeps): Promise<Result<DoctorOutput, AppError>> => {
  const media = await deps.media.dependencies();
  if (!media.ok) return media;
  const transcriber = await deps.transcriber.dependency();
  if (!transcriber.ok) return transcriber;
  const analyzer = await deps.analyzer.dependency();
  if (!analyzer.ok) return analyzer;
  const localAi = await deps.localAi.dependency();
  if (!localAi.ok) return localAi;
  const machine = await deps.localAi.machine();
  if (!machine.ok) return machine;

  const dependencies = [...media.value, transcriber.value, analyzer.value, localAi.value];
  return ok({
    dependencies,
    machine: {
      platform: machine.value.platform,
      arch: machine.value.arch,
      totalMemGB: machine.value.ramGb,
      appleSilicon: machine.value.platform === 'darwin' && machine.value.arch === 'arm64',
    },
    recommendedLocalModel: recommendedLocalModel(machine.value),
    allAvailable: dependencies.every((dependency) => dependency.available),
  });
};

const recommendedLocalModel = (machine: MachineProfile): string | null => {
  const supported = Object.values(LOCAL_AI_HARDWARE_TIERS).filter(
    (tier) => getLocalAiSupportLevel(tier, machine) === 'ok',
  );
  if (supported.length === 0) return null;
  const defaultTier = supported.find((tier) => tier.tag === 'gemma3:12b') ?? null;
  if (defaultTier !== null) return defaultTier.tag;
  return supported.reduce((best, tier) => (tier.minimumRamGb > best.minimumRamGb ? tier : best)).tag;
};
