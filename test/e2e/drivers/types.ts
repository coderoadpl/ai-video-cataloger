/**
 * A pipeline driver abstracts HOW the user runs the tool - through the CLI or
 * by clicking the Electron GUI - so the very same scenario tests execute
 * against both. All state assertions happen on disk (files + catalog.db),
 * which is identical for both drivers by design (CLI is the single engine).
 */

export interface AnalyzeOutcome {
  /** True when the pipeline reported success (exit 0 / no error events). */
  ok: boolean;
  /** Error messages observed (NDJSON error events / GUI error surface). */
  errors: string[];
}

export interface BatchOutcome {
  success: number;
  failed: number;
}

export interface PipelineDriver {
  readonly kind: 'cli' | 'gui';
  /** Bind the driver to a prepared work folder (GUI: launches the app on it). */
  open(workdir: string): Promise<void>;
  /** Run the full pipeline for one video (by its current filename). */
  analyze(filename: string): Promise<AnalyzeOutcome>;
  /**
   * Start analyzing `filename`, then cancel ~`afterMs` after processing
   * visibly started. Resolves once the pipeline has stopped.
   */
  analyzeAndCancel(filename: string, afterMs: number): Promise<void>;
  /** Analyze all pending videos in the folder, continuing past failures. */
  analyzeAll(): Promise<BatchOutcome>;
  close(): Promise<void>;
}
