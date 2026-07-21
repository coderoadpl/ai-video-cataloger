import {
  LOCAL_AI_HARDWARE_TIERS,
  builtInHarnessProviders,
  getLocalAiSupportLevel,
  ok,
  type AppError,
  type MachineProfile,
  type Result,
} from '@core/domain/index.js';

import type {
  AnalyzerPort,
  CredentialsStore,
  DependencyStatus,
  LocalAiRuntimePort,
  MediaPort,
  ProvidersPort,
  ProviderTestResult,
  TranscriberPort,
  ConfigStore,
  FileSystemPort,
} from '../ports.js';
import { getReadiness, type ReadinessCache, type ReadinessOutput } from './readiness.js';

export interface DoctorDeps {
  media: MediaPort;
  transcriber: TranscriberPort;
  analyzer: AnalyzerPort;
  providers: ProvidersPort;
  localAi: LocalAiRuntimePort;
  config: ConfigStore;
  fs: FileSystemPort;
  readiness: ReadinessCache;
  credentials?: CredentialsStore | undefined;
}

export interface DoctorWarning {
  code: string;
  message: string;
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
  warnings: DoctorWarning[];
  harnesses: Array<Extract<ProviderTestResult, { family: 'harness' }>>;
  configured: ReadinessOutput;
}

export const runDoctor = async (deps: DoctorDeps): Promise<Result<DoctorOutput, AppError>> => {
  const media = await deps.media.dependencies();
  if (!media.ok) return media;
  const transcriber = await deps.transcriber.dependency();
  if (!transcriber.ok) return transcriber;
  const analyzer = await deps.analyzer.dependency();
  if (!analyzer.ok) return analyzer;
  const machine = await deps.localAi.machine();
  if (!machine.ok) return machine;
  const localAi = await deps.localAi.dependency();
  if (!localAi.ok) return localAi;
  const harnesses = await detectHarnesses(deps.providers);
  const configured = await getReadiness(deps);
  if (!configured.ok) return configured;
  const migrations = await secretMigrationWarnings(deps.credentials);
  if (!migrations.ok) return migrations;

  const dependencies = [...media.value, transcriber.value, analyzer.value, localAiDependency(localAi.value, machine.value)];
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
    warnings: [...dependencyWarnings(dependencies), ...migrations.value],
    harnesses,
    configured: configured.value,
  });
};

const dependencyWarnings = (dependencies: DependencyStatus[]): DoctorWarning[] =>
  dependencies.flatMap((dependency) =>
    dependency.warning === undefined ? [] : [{ code: `${dependency.name}_warning`, message: dependency.warning }]);

const secretMigrationWarnings = async (
  credentials: CredentialsStore | undefined,
): Promise<Result<DoctorWarning[], AppError>> => {
  if (credentials?.legacyPlaintextProviders === undefined) return ok([]);
  const providers = await credentials.legacyPlaintextProviders();
  if (!providers.ok) return providers;
  return ok(providers.value.map((providerId) => ({
    code: 'secret_migration',
    message: `The API key for "${providerId}" is stored in plaintext config. Run: ai-video-cataloger setup to move it into the macOS Keychain.`,
  })));
};

const detectHarnesses = async (
  providers: ProvidersPort,
): Promise<Array<Extract<ProviderTestResult, { family: 'harness' }>>> =>
  Promise.all(builtInHarnessProviders().map(async (descriptor) => {
    const provider = {
      family: descriptor.family,
      providerId: descriptor.providerId,
      command: descriptor.command,
      argsTemplate: descriptor.argsTemplate,
      promptStyle: descriptor.promptStyle,
    };
    const tested = await providers.test(provider);
    if (tested.ok && tested.value.family === 'harness') return tested.value;
    return {
      family: 'harness',
      providerId: provider.providerId,
      available: false,
      version: null,
      latencyMs: null,
      message: tested.ok ? 'Provider returned the wrong availability result' : tested.error.message,
    };
  }));

const localAiDependency = (dependency: DependencyStatus, machine: MachineProfile): DependencyStatus => {
  if (machine.platform !== 'darwin' || machine.arch !== 'arm64') {
    return {
      name: 'local-ai',
      available: false,
      version: null,
      source: null,
      path: null,
      installHint: 'Local AI requires an Apple Silicon Mac (use the claude backend instead)',
    };
  }
  if (dependency.available) return { ...dependency, name: 'local-ai' };
  return {
    name: 'local-ai',
    available: true,
    version: 'auto-managed (not running - starts when needed)',
    source: 'bundled',
    path: null,
    installHint: '',
  };
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
