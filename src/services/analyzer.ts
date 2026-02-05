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
function buildAnalysisPrompt(videoName: string, transcript: string | null, frameCount: number): string {
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

  prompt += `I have also provided ${frameCount} frame(s) from the video as images.

Based on the visual content from the frames${transcript ? ' and the audio transcript' : ''}, please provide:

1. A 2-3 sentence description of what this video is about
2. A suggested filename (3-5 words, kebab-case format like "cat-playing-with-yarn")

Please format your response EXACTLY as follows:
DESCRIPTION: <your 2-3 sentence description here>
FILENAME: <your-suggested-filename-in-kebab-case>

Focus on being descriptive and accurate. The filename should capture the essence of the video content.`;

  return prompt;
}

/**
 * Analyze a video using Claude Code CLI
 * @param video - The video record to analyze
 * @param hasTranscript - Whether the video has a transcript
 * @param options - Analysis options including timeout
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

  // Track elapsed time for spinner
  let elapsedSeconds = 0;
  const startTime = Date.now();

  const spinner = ora({
    text: `Analyzing ${chalk.cyan(video.original_name)} with Claude (0s)`,
    color: 'blue',
  }).start();

  // Update spinner with elapsed time every second
  const elapsedTimer = setInterval(() => {
    elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
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

    // Build the prompt
    const prompt = buildAnalysisPrompt(video.original_name, transcript, framePaths.length);

    // Build claude CLI command with frames as attachments
    const args = ['-p', prompt];

    // Add each frame as an attachment
    for (const framePath of framePaths) {
      args.push(framePath);
    }

    // Call Claude Code CLI with timeout
    const result = await execa('claude', args, { timeout: timeoutMs });
    const response = result.stdout;

    // Clear the elapsed timer
    clearInterval(elapsedTimer);

    // Parse the response
    const analysis = parseClaudeResponse(response);

    // Create summaries directory if it doesn't exist
    const summariesDir = getSummariesDir(videoPath);
    if (!existsSync(summariesDir)) {
      mkdirSync(summariesDir, { recursive: true });
    }

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

    spinner.succeed(`Analyzed ${chalk.cyan(video.original_name)} (${Math.floor((Date.now() - startTime) / 1000)}s)`);

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
