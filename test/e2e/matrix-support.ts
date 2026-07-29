import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

export interface MatrixSummaryRow {
  cell: string;
  result: string;
  durationMs: number;
}

const ollamaTagsSchema = z.object({
  models: z.array(z.object({
    name: z.string().optional(),
    model: z.string().optional(),
  })),
});

export const systemOllamaModelMissingReason = async (
  baseUrl: string,
  model: string,
): Promise<string | null> => {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    return `Ollama ${baseUrl} is unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!response.ok) return `Ollama ${baseUrl} returned HTTP ${String(response.status)}`;
  const tags = ollamaTagsSchema.parse(await response.json());
  const installed = tags.models.some((entry) => entry.name === model || entry.model === model);
  if (!installed) return `Ollama ${baseUrl} does not have ${model} installed`;
  return null;
};

export const matrixHome = (environment: NodeJS.ProcessEnv): string =>
  environment.E2E_MATRIX_HOME ?? join(homedir(), 'repositories', 'claude-tmp', 'avc-e2e-matrix-home');

export const matrixAllowsSkip = (value: string | undefined): boolean =>
  value === '1' || value === 'true';

export const missingLegMessage = (cell: string, reason: string): string =>
  `E2E MATRIX PREFLIGHT FAILED [${cell}]\n${reason}\nSet E2E_MATRIX_ALLOW_SKIP=1 only to opt out of unavailable environmental legs.`;

export const formatMatrixSummary = (rows: readonly MatrixSummaryRow[]): string => {
  const headings = { cell: 'CELL', result: 'RESULT', duration: 'DURATION' };
  const rendered = rows.map((row) => ({
    cell: row.cell,
    result: row.result,
    duration: `${(row.durationMs / 1000).toFixed(1)}s`,
  }));
  const cellWidth = Math.max(headings.cell.length, ...rendered.map((row) => row.cell.length));
  const resultWidth = Math.max(headings.result.length, ...rendered.map((row) => row.result.length));
  const durationWidth = Math.max(headings.duration.length, ...rendered.map((row) => row.duration.length));
  const line = (cell: string, result: string, duration: string): string =>
    `${cell.padEnd(cellWidth)} | ${result.padEnd(resultWidth)} | ${duration.padStart(durationWidth)}`;
  return [
    'E2E MATRIX SUMMARY',
    line(headings.cell, headings.result, headings.duration),
    `${'-'.repeat(cellWidth)}-+-${'-'.repeat(resultWidth)}-+-${'-'.repeat(durationWidth)}`,
    ...rendered.map((row) => line(row.cell, row.result, row.duration)),
  ].join('\n');
};
