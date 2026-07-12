export const ERROR_CODES = ['validation', 'not_found', 'conflict', 'internal'] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export const appError = (code: ErrorCode, message: string, details?: unknown): AppError =>
  details === undefined ? { code, message } : { code, message, details };

export const validation = (message: string, details?: unknown): AppError =>
  appError('validation', message, details);

export const notFound = (message = 'Not found'): AppError => appError('not_found', message);

export const conflict = (message = 'Conflict'): AppError => appError('conflict', message);

export const internal = (message = 'Internal error'): AppError => appError('internal', message);
