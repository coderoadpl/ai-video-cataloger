/**
 * Video analyzer service - thin orchestrator over analyzer providers.
 *
 * Gathers frames + transcript, delegates to the selected provider (claude CLI
 * or local Ollama), writes the debug log, parses/validates the shared
 * DESCRIPTION:/FILENAME: response contract and persists the summary.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { updateVideoStatus } from '../db/index.js';
import { getFramesDir } from './frames.js';
import { getTranscriptPath } from './transcription.js';
import { getSummariesDir, writeSummary } from './summary-format.js';
import { parseAnalysisResponse, type AnalysisResult } from './analyzer-providers/response-format.js';
import { ClaudeCliProvider } from './analyzer-providers/claude-cli.js';
import type { AnalyzerBackend, AnalyzerProvider } from './analyzer-providers/types.js';
import type { VideoRecord } from '../types/index.js';

export type { AnalysisResult };

export interface AnalysisOptions {
  timeoutSeconds?: number;
  verbose?: boolean;
  /** Which analysis backend to use (default: claude). */
  analyzer?: AnalyzerBackend;
  /** Ollama model tag for the local backend (default: gemma3:12b). */
  localModel?: string;
}

/** Instantiate the provider for the requested backend. */
async function createProvider(options: AnalysisOptions): Promise<AnalyzerProvider> {
  if (options.analyzer === 'local') {
    // Lazy import keeps the claude path free of any local-runtime concerns
    const { OllamaProvider } = await import('./analyzer-providers/ollama.js');
    return new OllamaProvider(options.localModel ?? 'gemma3:12b');
  }
  return new ClaudeCliProvider();
}

/**
 * Get the debug log path for a video
 */
export function getDebugLogPath(videoPath: string): string {
  const videoName = basename(videoPath, extname(videoPath));
  return join(getSummariesDir(videoPath), `${videoName}-debug.log`);
}

/**
 * Analyze a video using the selected provider
 * @param video - The video record to analyze
 * @param hasTranscript - Whether the video has a transcript
 * @param options - Analysis options including timeout, verbose mode and backend
 */
export async function analyzeVideo(
  video: VideoRecord,
  hasTranscript: boolean,
  options: AnalysisOptions = {}
): Promise<AnalysisResult> {
  const videoPath = video.original_path;
  const timeoutSeconds = options.timeoutSeconds ?? 120;
  const timeoutMs = timeoutSeconds * 1000;
  const verbose = options.verbose ?? false;

  const provider = await createProvider(options);

  // Track elapsed time for spinner
  const startTime = Date.now();

  const spinner = ora({
    text: `Analyzing ${chalk.cyan(video.original_name)} with ${provider.label} (0s)`,
    color: 'blue',
  }).start();

  const elapsedTimer = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    spinner.text = `Analyzing ${chalk.cyan(video.original_name)} with ${provider.label} (${elapsedSeconds}s)`;
  }, 1000);

  try {
    // Get frame files
    const framesDir = getFramesDir(videoPath);
    let framePaths: string[] = [];

    if (existsSync(framesDir)) {
      const frameFiles = readdirSync(framesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort();
      framePaths = frameFiles.map(f => join(framesDir, f));
    }

    if (framePaths.length === 0) {
      clearInterval(elapsedTimer);
      throw new Error('No frames found for analysis');
    }

    // Get transcript if available
    let transcript: string | null = null;
    if (hasTranscript) {
      const transcriptPath = getTranscriptPath(videoPath);
      if (existsSync(transcriptPath)) {
        transcript = readFileSync(transcriptPath, 'utf-8').trim();
      }
    }

    // Create summaries directory early (needed for debug log)
    const summariesDir = getSummariesDir(videoPath);
    if (!existsSync(summariesDir)) {
      mkdirSync(summariesDir, { recursive: true });
    }

    // Providers print their own verbose diagnostics - keep the spinner quiet
    if (verbose) spinner.stop();
    const { rawResponse } = await provider.analyze({
      videoName: video.original_name,
      videoDir: dirname(videoPath),
      framePaths,
      transcript,
      timeoutMs,
      verbose,
    });
    if (verbose) spinner.start();

    clearInterval(elapsedTimer);

    // Save debug log with the full response
    // (written before parsing so failed parses still leave a debug trail)
    const debugLogPath = getDebugLogPath(videoPath);
    const debugContent = `Video: ${video.original_name}
Analyzer: ${provider.id} (${provider.label})
Date Analyzed: ${new Date().toISOString()}
Elapsed Time: ${Math.floor((Date.now() - startTime) / 1000)}s

=== FRAME PATHS ===
${framePaths.map(fp => `  • ${fp}`).join('\n')}

=== FULL RESPONSE ===
${rawResponse}
`;
    writeFileSync(debugLogPath, debugContent, 'utf-8');

    // Parse the response (throws ANALYSIS_PARSE_FAILED if no filename found)
    const analysis = parseAnalysisResponse(rawResponse);

    // Save the summary (.json source of truth + regenerated .txt)
    writeSummary(videoPath, {
      schemaVersion: 1,
      description: analysis.description,
      suggestedFilename: analysis.suggestedFilename,
      fullAnalysis: analysis.fullAnalysis,
      analyzedAt: new Date().toISOString(),
    });

    // Update video status in database
    updateVideoStatus(video.id, 'analyzed');

    const finalElapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    spinner.succeed(`Analyzed ${chalk.cyan(video.original_name)} (${finalElapsedSeconds}s)`);

    if (verbose) {
      console.log(chalk.gray('\n[verbose] Full analysis response shown above'));
    } else {
      const preview = rawResponse.length > 100
        ? rawResponse.substring(0, 100).replace(/\n/g, ' ') + '...'
        : rawResponse.replace(/\n/g, ' ');
      console.log(chalk.gray(`  Response preview: ${preview}`));
    }

    return analysis;
  } catch (error) {
    clearInterval(elapsedTimer);

    // Check if this was a timeout error
    if (error && typeof error === 'object' && 'timedOut' in error && (error as { timedOut: boolean }).timedOut) {
      const timeoutError = new Error(`Analysis timed out after ${timeoutSeconds} seconds`);
      spinner.fail(`Analysis timed out for ${chalk.cyan(video.original_name)} after ${timeoutSeconds}s`);
      throw timeoutError;
    }

    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(`Failed to analyze ${chalk.cyan(video.original_name)}: ${message}`);
    throw error;
  }
}
