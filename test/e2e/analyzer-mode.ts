/**
 * E2E analyzer mode: the SAME scenarios run against the claude backend
 * (default) or the fully-local one (E2E_ANALYZER=local), with the model
 * selectable via E2E_LOCAL_MODEL (defaults to the app default gemma3:12b).
 */

export type E2eAnalyzer = 'claude' | 'local';

const raw = process.env.E2E_ANALYZER ?? 'claude';
if (raw !== 'claude' && raw !== 'local') {
  throw new Error(`Invalid E2E_ANALYZER=${raw} (expected claude|local)`);
}

export const E2E_ANALYZER: E2eAnalyzer = raw;
export const E2E_LOCAL_MODEL = process.env.E2E_LOCAL_MODEL ?? 'gemma3:12b';

/** Extra process-command flags for the CLI driver in local mode. */
export function analyzerCliFlags(): string[] {
  return E2E_ANALYZER === 'local'
    ? ['--analyzer', 'local', '--local-model', E2E_LOCAL_MODEL]
    : [];
}
