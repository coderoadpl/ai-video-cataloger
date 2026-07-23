import type { z } from 'zod';

import type { doctorOutputSchema, readinessOutputSchema } from '@core/contract/index.js';
import type { WhisperModelName } from '@core/domain/index.js';

import { type Dictionary } from '../../i18n/dictionary.js';
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

const dependencyStatus = (dependency: Dependency): ChecklistStatus => {
  if (!dependency.available) return 'error';
  if (dependency.warning !== undefined && dependency.warning.trim().length > 0) return 'warning';
  return 'ok';
};

export const buildReadinessChecklist = (
  dictionary: Dictionary,
  doctor: Doctor | null,
  readiness: Readiness | null,
  whisperModels: readonly WhisperModelChoice[],
): ChecklistRow[] => {
  const copy = dictionary.wizard.checklist;
  const rows: ChecklistRow[] = [];

  if (doctor !== null) {
    for (const dependency of doctor.dependencies) {
      const status = dependencyStatus(dependency);
      const isWhisperRuntime = dependency.name === 'whisper';
      rows.push({
        id: `dep-${dependency.name}`,
        name: copy.dependencyNames[dependency.name] ?? dependency.name,
        description: copy.dependencyDescriptions[dependency.name] ?? copy.checkedSystemDependency,
        status,
        action: isWhisperRuntime && status !== 'ok' ? { kind: 'goto-transcription' } : null,
        actionLabel: isWhisperRuntime && status !== 'ok' ? copy.fixInTranscription : null,
      });
    }
  }

  const configured = readiness ?? doctor?.configured ?? null;
  if (configured !== null) {
    rows.push({
      id: 'configured-analyzer',
      name: copy.configuredAnalyzer(configured.analyzer.providerId),
      description: copy.configuredAnalyzerDescription,
      status: configured.analyzer.available ? 'ok' : 'error',
      action: configured.analyzer.available ? null : { kind: 'goto-analyzer' },
      actionLabel: configured.analyzer.available ? null : copy.backToAnalyzer,
    });

    const transcriber = configured.transcriber;
    if (transcriber.mode === 'local' && transcriber.model !== null) {
      const model = transcriber.model;
      const best = bestInstalledWhisperModel(whisperModels);
      const canActivate = best !== null && best !== model;
      rows.push({
        id: 'configured-whisper-model',
        name: copy.configuredWhisperModel(model),
        description: copy.configuredWhisperModelDescription,
        status: transcriber.available ? 'ok' : 'error',
        action: transcriber.available
          ? null
          : canActivate
            ? { kind: 'activate-whisper', model: best }
            : { kind: 'download-whisper', model },
        actionLabel: transcriber.available ? null : canActivate ? copy.useModel(best) : copy.downloadModel(model),
      });
    } else if (transcriber.mode === 'api') {
      rows.push({
        id: 'configured-transcriber-api',
        name: copy.configuredTranscriptionApi,
        description: copy.configuredTranscriptionApiDescription,
        status: transcriber.available ? 'ok' : 'error',
        action: transcriber.available ? null : { kind: 'goto-transcription' },
        actionLabel: transcriber.available ? null : copy.fixInTranscription,
      });
    }
  }

  return rows;
};
