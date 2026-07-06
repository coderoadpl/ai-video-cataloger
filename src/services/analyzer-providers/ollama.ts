/**
 * Local analyzer provider backed by a managed Ollama runtime.
 * Placeholder in F1 - the real implementation lands in F2.
 */

import { CodedError } from '../json-output.js';
import type { AnalyzerInput, AnalyzerProvider } from './types.js';

export class OllamaProvider implements AnalyzerProvider {
  readonly id = 'local' as const;
  readonly label: string;

  constructor(private readonly model: string) {
    this.label = `${model} (local)`;
  }

  async analyze(_input: AnalyzerInput): Promise<{ rawResponse: string }> {
    throw new CodedError(
      `Local analyzer (${this.model}) is not available yet`,
      'OLLAMA_UNAVAILABLE'
    );
  }
}
