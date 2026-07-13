import type { WhisperMode } from '../samples.js';

export interface AnalyzeOptions {
  whisper: WhisperMode;
}

export interface AnalyzeOutcome {
  ok: boolean;
  errors: string[];
}

export interface BatchOutcome {
  success: number;
  failed: number;
}

export interface PipelineDriver {
  readonly kind: 'cli' | 'gui';
  open(workdir: string): Promise<void>;
  analyze(filename: string, options: AnalyzeOptions): Promise<AnalyzeOutcome>;
  analyzeAndCancel(filename: string, afterMs: number, options: AnalyzeOptions): Promise<void>;
  analyzeAll(options: AnalyzeOptions): Promise<BatchOutcome>;
  close(): Promise<void>;
}
