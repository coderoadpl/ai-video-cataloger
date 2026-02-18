/**
 * Video analyzer service
 * Analyzes video frames and transcripts using Claude Code CLI
 */

import { execa } from 'execa';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { updateVideoStatus } from '../db/index.js';
import { getFramesDir } from './frames.js';
import { getTranscriptPath } from './transcription.js';
import type { VideoRecord } from '../types/index.js';

/**
 * Get the summaries directory for a video
 */
export function getSummariesDir(videoPath: string): string {
  const videoDir = dirname(videoPath);
  return join(videoDir, 'summaries');
}

/**
 * Get the summary file path for a video
 */
export function getSummaryPath(videoPath: string): string {
  const videoName = basename(videoPath, extname(videoPath));
  return join(getSummariesDir(videoPath), `${videoName}.txt`);
}

/**
 * Extract the suggested filename from an existing summary file
 * Used when resuming from 'analyzed' status
 */
export function getSuggestedFilenameFromSummary(videoPath: string): string | null {
  const summaryPath = getSummaryPath(videoPath);

  if (!existsSync(summaryPath)) {
    return null;
  }

  try {
    const content = readFileSync(summaryPath, 'utf-8');
    const match = content.match(/SUGGESTED FILENAME:\s*\n?([^\n]+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return null;
  } catch {
    return null;
  }
}

export interface AnalysisResult {
  description: string;
  suggestedFilename: string;
  fullAnalysis: string;
}

export interface AnalysisOptions {
  timeoutSeconds?: number;
  verbose?: boolean;
}

/**
 * Parse Claude's response to extract description and filename suggestion
 * Expected format:
 * DESCRIPTION: <2-3 sentences>
 * FILENAME: <suggested-filename-in-kebab-case>
 */
function parseClaudeResponse(response: string): AnalysisResult {
  const lines = response.trim().split('\n');

  let description = '';
  let suggestedFilename = '';
  let capturingDescription = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.toUpperCase().startsWith('DESCRIPTION:')) {
      description = trimmedLine.substring('DESCRIPTION:'.length).trim();
      capturingDescription = true;
    } else if (trimmedLine.toUpperCase().startsWith('FILENAME:')) {
      suggestedFilename = trimmedLine.substring('FILENAME:'.length).trim();
      capturingDescription = false;
    } else if (capturingDescription && trimmedLine && !trimmedLine.toUpperCase().startsWith('FILENAME')) {
      // Continue capturing multi-line description
      description += ' ' + trimmedLine;
    }
  }

  // Clean up the suggested filename (ensure kebab-case)
  suggestedFilename = suggestedFilename
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // If parsing failed, use the full response as description and generate a generic filename
  if (!description) {
    description = response.trim().substring(0, 500);
  }
  if (!suggestedFilename) {
    suggestedFilename = 'video-content';
  }

  return {
    description: description.trim(),
    suggestedFilename,
    fullAnalysis: response,
  };
}

/**
 * Build the prompt for Claude to analyze the video
 */
function buildAnalysisPrompt(videoName: string, transcript: string | null, framePaths: string[]): string {
  let prompt = `You are analyzing a video file named "${videoName}".

`;

  if (transcript) {
    prompt += `Here is the transcript of the audio:
---
${transcript}
---

`;
  } else {
    prompt += `This video has no audio or transcript available.

`;
  }

  // Include frame images using file:// URLs so Claude can view them
  prompt += `Here are ${framePaths.length} frame(s) extracted from the video:\n`;
  for (const framePath of framePaths) {
    prompt += `file://${framePath}\n`;
  }
  prompt += `\n`;

  prompt += `Based on the visual content from the frames${transcript ? ' and the audio transcript' : ''}, please provide:

1. A 2-3 sentence description of what this video is about
2. A suggested filename (3-5 words, kebab-case format like "cat-playing-with-yarn")

Please format your response EXACTLY as follows:
DESCRIPTION: <your 2-3 sentence description here>
FILENAME: <your-suggested-filename-in-kebab-case>

Focus on being descriptive and accurate. The filename should capture the essence of the video content.`;

  return prompt;
}

/**
 * Get the debug log path for a video
 */
export function getDebugLogPath(videoPath: string): string {
  const videoName = basename(videoPath, extname(videoPath));
  return join(getSummariesDir(videoPath), `${videoName}-debug.log`);
}

/**
 * Analyze a video using Claude Code CLI
 * @param video - The video record to analyze
 * @param hasTranscript - Whether the video has a transcript
 * @param options - Analysis options including timeout and verbose mode
 * @returns Analysis result with description and suggested filename
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

  // Track elapsed time for spinner
  const startTime = Date.now();

  const spinner = ora({
    text: `Analyzing ${chalk.cyan(video.original_name)} with Claude (0s)`,
    color: 'blue',
  }).start();

  // Update spinner with elapsed time every second
  const elapsedTimer = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    spinner.text = `Analyzing ${chalk.cyan(video.original_name)} with Claude (${elapsedSeconds}s)`;
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

    // Build the prompt with frame paths included as file:// URLs
    const prompt = buildAnalysisPrompt(video.original_name, transcript, framePaths);

    // Create summaries directory early (needed for debug log)
    const summariesDir = getSummariesDir(videoPath);
    if (!existsSync(summariesDir)) {
      mkdirSync(summariesDir, { recursive: true });
    }

    // Display verbose information
    if (verbose) {
      spinner.stop();
      console.log(chalk.gray('\n[verbose] Frame paths being analyzed:'));
      for (const framePath of framePaths) {
        console.log(chalk.gray(`  • ${framePath}`));
      }
      console.log(chalk.gray('\n[verbose] Full prompt being sent to Claude:'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.gray(prompt));
      console.log(chalk.gray('─'.repeat(60)));
      console.log();
      spinner.start();
    }

    // Build claude CLI command (frames are included in the prompt as file:// URLs)
    // Use --add-dir to grant Claude permission to read files from the video's directory
    const videoDir = dirname(videoPath);
    const args = ['--add-dir', videoDir, '-p', prompt];

    // Call Claude Code CLI with timeout and stream stdout in real-time if verbose
    let response = '';

    if (verbose) {
      // Stop spinner while streaming output
      spinner.stop();
      console.log(chalk.gray(`[verbose] Running: claude --add-dir "${videoDir}" -p "<prompt>"`));
      console.log(chalk.gray('[verbose] Claude response (streaming):'));
      console.log(chalk.gray('─'.repeat(60)));

      // Use subprocess with streaming
      // stdin: 'ignore' prevents waiting for input
      const subprocess = execa('claude', args, { timeout: timeoutMs, stdin: 'ignore' });

      // Stream stdout in real-time
      subprocess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        process.stdout.write(chalk.gray(chunk));
        response += chunk;
      });

      // Stream stderr for debugging
      subprocess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        process.stderr.write(chalk.red('[stderr] ' + chunk));
      });

      // Wait for the process to complete
      await subprocess;

      console.log(chalk.gray('\n' + '─'.repeat(60)));
      console.log();

      // Restart spinner with final elapsed time
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      spinner.text = `Analyzing ${chalk.cyan(video.original_name)} with Claude (${elapsedSeconds}s)`;
      spinner.start();
    } else {
      // Normal mode: wait for complete response
      // stdin: 'ignore' prevents waiting for input
      const result = await execa('claude', args, { timeout: timeoutMs, stdin: 'ignore' });
      response = result.stdout;
    }

    // Clear the elapsed timer
    clearInterval(elapsedTimer);

    // Parse the response
    const analysis = parseClaudeResponse(response);

    // Save debug log with prompt and full response
    const debugLogPath = getDebugLogPath(videoPath);
    const debugContent = `Video: ${video.original_name}
Date Analyzed: ${new Date().toISOString()}
Elapsed Time: ${Math.floor((Date.now() - startTime) / 1000)}s

=== FRAME PATHS ===
${framePaths.map(fp => `  • ${fp}`).join('\n')}

=== FULL PROMPT ===
${prompt}

=== FULL RESPONSE ===
${response}
`;
    writeFileSync(debugLogPath, debugContent, 'utf-8');

    // Save full analysis to file
    const summaryPath = getSummaryPath(videoPath);
    const summaryContent = `Video: ${video.original_name}
Date Analyzed: ${new Date().toISOString()}

DESCRIPTION:
${analysis.description}

SUGGESTED FILENAME:
${analysis.suggestedFilename}

FULL ANALYSIS:
${analysis.fullAnalysis}
`;
    writeFileSync(summaryPath, summaryContent, 'utf-8');

    // Update video status in database
    updateVideoStatus(video.id, 'analyzed');

    const finalElapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    spinner.succeed(`Analyzed ${chalk.cyan(video.original_name)} (${finalElapsedSeconds}s)`);

    // Show response preview: full in verbose mode, truncated in normal mode
    if (verbose) {
      console.log(chalk.gray('\n[verbose] Full analysis response shown above'));
    } else {
      // Show truncated preview (100 chars) in normal mode
      const preview = response.length > 100
        ? response.substring(0, 100).replace(/\n/g, ' ') + '...'
        : response.replace(/\n/g, ' ');
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
