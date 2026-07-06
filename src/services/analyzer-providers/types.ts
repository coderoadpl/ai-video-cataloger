/**
 * Analyzer provider abstraction: a provider turns frames + transcript into a
 * raw text response following the shared DESCRIPTION:/FILENAME: contract
 * (parsed and validated centrally in response-format.ts).
 */

export type AnalyzerBackend = 'claude' | 'local';

export interface AnalyzerInput {
  videoName: string;
  /** Directory containing the video (claude provider grants read access to it). */
  videoDir: string;
  framePaths: string[];
  transcript: string | null;
  timeoutMs: number;
  verbose: boolean;
}

export interface AnalyzerProvider {
  readonly id: AnalyzerBackend;
  /** Human label used in spinners/logs, e.g. "Claude" or "gemma3:12b (local)". */
  readonly label: string;
  analyze(input: AnalyzerInput): Promise<{ rawResponse: string }>;
}
