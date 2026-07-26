import { EXIT_CODE_BY_ERROR_CODE, LEGACY_ERROR_CODE_BY_ERROR_CODE } from '@core/contract/index.js';
import type { AppError } from '@core/domain/index.js';

interface BaseEvent {
  type: 'started' | 'progress' | 'completed' | 'error';
  timestamp: string;
}

export interface StartedEvent extends BaseEvent {
  type: 'started';
  command: string;
  data?: unknown;
}

export interface ProgressEvent extends BaseEvent {
  type: 'progress';
  step: string;
  percentage?: number;
  current?: number;
  total?: number;
  data?: unknown;
}

export interface CompletedEvent extends BaseEvent {
  type: 'completed';
  data?: unknown;
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  message: string;
  code: string;
  data?: unknown;
}

export const isJsonMode = (options: { json?: boolean | undefined }): boolean => options.json === true;

export const emitStarted = (json: boolean, command: string, data?: unknown): void => {
  if (!json) return;
  writeJson(data === undefined ? { type: 'started', timestamp: now(), command } : {
    type: 'started',
    timestamp: now(),
    command,
    data,
  });
};

export const emitProgress = (
  json: boolean,
  input: {
    step: string;
    percentage?: number | undefined;
    current?: number | undefined;
    total?: number | undefined;
    data?: unknown;
  },
): void => {
  if (!json) return;
  writeJson({
    type: 'progress',
    timestamp: now(),
    step: input.step,
    ...(input.percentage === undefined ? {} : { percentage: input.percentage }),
    ...(input.current === undefined ? {} : { current: input.current }),
    ...(input.total === undefined ? {} : { total: input.total }),
    ...(input.data === undefined ? {} : { data: input.data }),
  });
};

export const emitRaw = (json: boolean, data: unknown, human: string): void => {
  if (json) {
    writeJson(data);
  } else {
    process.stdout.write(human.length === 0 ? '' : `${human}\n`);
  }
};

export const emitCompleted = (json: boolean, data?: unknown, human?: string): void => {
  if (json) {
    writeJson(data === undefined ? { type: 'completed', timestamp: now() } : {
      type: 'completed',
      timestamp: now(),
      data,
    });
    return;
  }
  if (human !== undefined && human.length > 0) process.stdout.write(`${human}\n`);
};

export const emitWarning = (message: string): void => {
  process.stderr.write(`warning: ${message}\n`);
};

export const emitError = (json: boolean, error: AppError, data?: unknown): void => {
  if (json) {
    writeJson({
      type: 'error',
      timestamp: now(),
      message: error.message,
      code: LEGACY_ERROR_CODE_BY_ERROR_CODE[error.code],
      ...(data === undefined ? {} : { data }),
    });
  } else {
    process.stderr.write(`error(${LEGACY_ERROR_CODE_BY_ERROR_CODE[error.code]}): ${error.message}\n`);
  }
  process.exitCode = EXIT_CODE_BY_ERROR_CODE[error.code];
};

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const now = (): string => new Date().toISOString();
