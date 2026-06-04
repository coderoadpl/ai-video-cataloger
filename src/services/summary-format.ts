/**
 * Summary format service
 * Single source of truth for the video summary format.
 * The .json file is the machine-readable source of truth; the .txt file
 * is a human-readable rendering generated from the same data.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';

/**
 * Structured summary data (machine-readable source of truth)
 */
export interface SummaryData {
  schemaVersion: 1;
  description: string;
  suggestedFilename: string;
  fullAnalysis: string;
  analyzedAt: string;
}

/**
 * Get the summaries directory for a video
 */
export function getSummariesDir(videoPath: string): string {
  const videoDir = dirname(videoPath);
  return join(videoDir, 'summaries');
}

/**
 * Get the human-readable summary file path (.txt) for a video
 */
export function getSummaryPath(videoPath: string): string {
  const videoName = basename(videoPath, extname(videoPath));
  return join(getSummariesDir(videoPath), `${videoName}.txt`);
}

/**
 * Get the machine-readable summary file path (.json) for a video
 */
export function getSummaryJsonPath(videoPath: string): string {
  const videoName = basename(videoPath, extname(videoPath));
  return join(getSummariesDir(videoPath), `${videoName}.json`);
}

/**
 * Render the human-readable .txt content from summary data
 */
function renderSummaryText(videoName: string, data: SummaryData): string {
  return `Video: ${videoName}
Date Analyzed: ${data.analyzedAt}

DESCRIPTION:
${data.description}

SUGGESTED FILENAME:
${data.suggestedFilename}

FULL ANALYSIS:
${data.fullAnalysis}
`;
}

/**
 * Write the summary for a video.
 * Writes the machine-readable .json atomically (tmp file + rename) and
 * regenerates the human-readable .txt from the same data.
 */
export function writeSummary(videoPath: string, data: SummaryData): void {
  const summariesDir = getSummariesDir(videoPath);
  if (!existsSync(summariesDir)) {
    mkdirSync(summariesDir, { recursive: true });
  }

  // Write .json atomically: write a tmp file, then rename into place
  const jsonPath = getSummaryJsonPath(videoPath);
  const tmpPath = `${jsonPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmpPath, jsonPath);

  // Regenerate the human-readable .txt from the same data
  const txtPath = getSummaryPath(videoPath);
  writeFileSync(txtPath, renderSummaryText(basename(videoPath), data), 'utf-8');
}

/**
 * Validate that a parsed value matches the SummaryData shape
 */
function isSummaryData(value: unknown): value is SummaryData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.description === 'string' &&
    typeof record.suggestedFilename === 'string' &&
    typeof record.fullAnalysis === 'string' &&
    typeof record.analyzedAt === 'string'
  );
}

/**
 * Read the summary for a video from the machine-readable .json.
 * Returns null when the file is missing, corrupted, or fails validation.
 * Never invents values.
 */
export function readSummary(videoPath: string): SummaryData | null {
  const jsonPath = getSummaryJsonPath(videoPath);

  if (!existsSync(jsonPath)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch {
    return null;
  }

  if (!isSummaryData(parsed)) {
    return null;
  }

  return parsed;
}
