import type { ApiClient } from '@core/client/index.js';
import { WHISPER_ENGINE_LABELS, type AppError, type Result, type WhisperEngine } from '@core/domain/index.js';

type DoctorOutput = Awaited<ReturnType<ApiClient['doctor']>> extends Result<infer T, AppError> ? T : never;
type LiveOutput = Awaited<ReturnType<ApiClient['healthLive']>>;
type ReadyOutput = Awaited<ReturnType<ApiClient['healthReady']>>;

export const doctorHuman = (data: DoctorOutput, live: LiveOutput, ready: ReadyOutput): string => {
  const lines = data.dependencies.map((dependency) =>
    `${dependency.name}: ${dependency.available ? 'available' : 'missing'}${resolutionSuffix(dependency)}`);
  lines.push(`All available: ${data.allAvailable ? 'yes' : 'no'}`);
  for (const warning of data.warnings) lines.push(`Warning: ${warning.message}`);
  lines.push(`Liveness: ${live.ok ? `up v${live.value.version}` : `unavailable (${live.error.message})`}`);
  if (ready.ok) {
    lines.push('Readiness: ready');
    for (const check of ready.value.checks) lines.push(`  ${check.name}: ${check.ok ? 'ok' : 'not ready'} - ${check.detail}`);
  } else {
    lines.push(`Readiness: not ready (${ready.error.message})`);
  }
  lines.push('Configured processing:');
  const analyzer = data.configured.analyzer;
  lines.push(
    `Analyzer (${analyzer.providerId}): ${analyzer.available ? 'available' : 'missing'}`
    + ` (model: ${analyzer.model ?? 'CLI default'})`,
  );
  const transcriber = data.configured.transcriber;
  lines.push(
    `Transcriber (${transcriber.mode}): ${transcriber.available ? 'available' : 'missing'}`
    + resolutionSuffix({ engine: transcriber.engine, path: transcriber.binaryPath }),
  );
  if (data.configured.suggestedAction !== null) lines.push(data.configured.suggestedAction);
  return lines.join('\n');
};

const resolutionSuffix = (
  resolution: { engine?: WhisperEngine | null | undefined; path: string | null },
): string => {
  const engine = resolution.engine ?? null;
  if (engine === null) return '';
  const label = WHISPER_ENGINE_LABELS[engine];
  return resolution.path === null ? ` (engine: ${label})` : ` (engine: ${label}, binary: ${resolution.path})`;
};
