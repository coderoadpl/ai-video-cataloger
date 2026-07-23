import type { z } from 'zod';

import type { doctorOutputSchema, readinessOutputSchema } from '@core/contract/index.js';
import type { WhisperModelName } from '@core/domain/index.js';

import { bestInstalledWhisperModel, type WhisperModelChoice } from './wizard-model.js';

type Doctor = z.output<typeof doctorOutputSchema>;
type Readiness = z.output<typeof readinessOutputSchema>;
type Dependency = Doctor['dependencies'][number];

export type ChecklistStatus = 'ok' | 'warning' | 'error';

export type ChecklistAction =
  | { kind: 'download-whisper'; model: WhisperModelName }
  | { kind: 'activate-whisper'; model: WhisperModelName }
  | { kind: 'goto-analyzer' }
  | { kind: 'goto-transcription' };

export interface ChecklistRow {
  id: string;
  name: string;
  description: string;
  status: ChecklistStatus;
  action: ChecklistAction | null;
  actionLabel: string | null;
}

const DEPENDENCY_NAMES: Record<string, string> = {
  ffmpeg: 'FFmpeg',
  ffprobe: 'ffprobe',
  whisper: 'Whisper runtime',
  'local-ai': 'Local AI runtime',
  'api-provider': 'API provider',
  claude: 'Agent CLI harness',
  faces: 'Face grouping engine',
};

const DEPENDENCY_DESCRIPTIONS: Record<string, string> = {
  ffmpeg: 'Extracts frames and audio from your videos',
  ffprobe: 'Reads video metadata such as duration and streams',
  whisper: 'Runs local whisper.cpp transcription',
  'local-ai': 'Managed on-device AI runtime (Ollama)',
  'api-provider': 'Reaches your API provider with stored credentials',
  claude: 'Runs analysis through your agent CLI',
  faces: 'Groups faces on-device (only when enabled)',
};

const dependencyStatus = (dependency: Dependency): ChecklistStatus => {
  if (!dependency.available) return 'error';
  if (dependency.warning !== undefined && dependency.warning.trim().length > 0) return 'warning';
  return 'ok';
};

export const buildReadinessChecklist = (
  doctor: Doctor | null,
  readiness: Readiness | null,
  whisperModels: readonly WhisperModelChoice[],
): ChecklistRow[] => {
  const rows: ChecklistRow[] = [];

  if (doctor !== null) {
    for (const dependency of doctor.dependencies) {
      const status = dependencyStatus(dependency);
      const isWhisperRuntime = dependency.name === 'whisper';
      rows.push({
        id: `dep-${dependency.name}`,
        name: DEPENDENCY_NAMES[dependency.name] ?? dependency.name,
        description: DEPENDENCY_DESCRIPTIONS[dependency.name] ?? 'Checked system dependency',
        status,
        action: isWhisperRuntime && status !== 'ok' ? { kind: 'goto-transcription' } : null,
        actionLabel: isWhisperRuntime && status !== 'ok' ? 'Fix in Transcription' : null,
      });
    }
  }

  const configured = readiness ?? doctor?.configured ?? null;
  if (configured !== null) {
    rows.push({
      id: 'configured-analyzer',
      name: `Configured analyzer (${configured.analyzer.providerId})`,
      description: 'The analyzer you selected is reachable and configured',
      status: configured.analyzer.available ? 'ok' : 'error',
      action: configured.analyzer.available ? null : { kind: 'goto-analyzer' },
      actionLabel: configured.analyzer.available ? null : 'Back to Analyzer',
    });

    const transcriber = configured.transcriber;
    if (transcriber.mode === 'local' && transcriber.model !== null) {
      const model = transcriber.model;
      const best = bestInstalledWhisperModel(whisperModels);
      const canActivate = best !== null && best !== model;
      rows.push({
        id: 'configured-whisper-model',
        name: `Configured whisper model (${model})`,
        description: 'The transcription model you configured is installed on disk',
        status: transcriber.available ? 'ok' : 'error',
        action: transcriber.available
          ? null
          : canActivate
            ? { kind: 'activate-whisper', model: best }
            : { kind: 'download-whisper', model },
        actionLabel: transcriber.available ? null : canActivate ? `Use ${best}` : `Download ${model}`,
      });
    } else if (transcriber.mode === 'api') {
      rows.push({
        id: 'configured-transcriber-api',
        name: 'Configured transcription (OpenAI API)',
        description: 'The transcription API is reachable with stored credentials',
        status: transcriber.available ? 'ok' : 'error',
        action: transcriber.available ? null : { kind: 'goto-transcription' },
        actionLabel: transcriber.available ? null : 'Fix in Transcription',
      });
    }
  }

  return rows;
};
