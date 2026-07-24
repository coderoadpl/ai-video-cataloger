export const ERROR_CODES = [
  'validation',
  'not_found',
  'conflict',
  'file_not_found',
  'invalid_file_type',
  'not_a_file',
  'missing_api_key',
  'provider_auth_failed',
  'rate_limited',
  'provider_error',
  'prerequisites_failed',
  'invalid_model',
  'model_not_found',
  'confirmation_required',
  'force_required',
  'download_error',
  'delete_error',
  'video_not_found',
  'reset_failed',
  'unknown_config_key',
  'invalid_config_value',
  'folder_not_found',
  'not_a_directory',
  'read_error',
  'nested_databases_found',
  'drive_root_empty',
  'drive_run_aborted',
  'thumbnail_error',
  'processing_error',
  'analysis_parse_failed',
  'model_not_installed',
  'ollama_unavailable',
  'hw_requirements_not_met',
  'faces_disabled',
  'snapshot_incompatible',
  'catalog_locked',
  'internal',
] as const;

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
