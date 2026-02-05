/**
 * Type definitions for AI Video Cataloger
 */

export type WhisperMode = 'local' | 'api' | 'skip';

export type VideoStatus =
  | 'pending'
  | 'frames_extracted'
  | 'audio_extracted'
  | 'transcribed'
  | 'analyzed'
  | 'completed'
  | 'error';

export interface VideoRecord {
  id: number;
  original_path: string;
  original_name: string;
  new_name: string | null;
  file_hash: string;
  status: VideoStatus;
  created_at: string;
  updated_at: string;
  error_message: string | null;
}

export interface ConfigRecord {
  key: string;
  value: string;
}

export interface ProcessingOptions {
  frames: number;
  skipRename: boolean;
  verbose: boolean;
  retryErrors: boolean;
}
