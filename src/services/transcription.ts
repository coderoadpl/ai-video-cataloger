/**
 * Transcription service
 * Transcribes audio using local Whisper or OpenAI API
 */

import { execa } from 'execa';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import OpenAI from 'openai';
import { updateVideoStatus } from '../db/index.js';
import { getTempAudioPath } from './audio.js';
import type { VideoRecord, WhisperMode } from '../types/index.js';

/**
 * Get the transcripts directory for a video
 */
export function getTranscriptsDir(videoPath: string): string {
  const videoDir = dirname(videoPath);
  return join(videoDir, 'transcripts');
}

/**
 * Get the transcript file path for a video
 */
export function getTranscriptPath(videoPath: string): string {
  const videoName = basename(videoPath, extname(videoPath));
  return join(getTranscriptsDir(videoPath), `${videoName}.txt`);
}

export interface TranscriptionResult {
  transcribed: boolean;
  transcriptPath: string | null;
  transcript: string | null;
}

export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

export interface TranscriptionOptions {
  mode: WhisperMode;
  model?: WhisperModel;
}

/**
 * Transcribe audio from a video using OpenAI Whisper API
 * @param video - The video record to transcribe
 * @param audioPath - Path to the audio file
 * @param transcriptsDir - Directory to save the transcript
 * @returns Result containing whether transcription occurred and the transcript content
 */
async function transcribeWithApi(
  video: VideoRecord,
  audioPath: string,
  transcriptsDir: string
): Promise<TranscriptionResult> {
  const spinner = ora({
    text: `Transcribing ${chalk.cyan(video.original_name)} with OpenAI Whisper API`,
    color: 'blue',
  }).start();

  try {
    // Initialize OpenAI client (uses OPENAI_API_KEY from environment)
    const openai = new OpenAI();

    // Create a readable stream from the audio file
    const audioStream = createReadStream(audioPath);

    // Call the OpenAI Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-1',
    });

    const transcript = transcription.text.trim();

    // Save transcript to file (same location as local mode)
    const videoPath = video.original_path;
    const videoName = basename(videoPath, extname(videoPath));
    const transcriptPath = join(transcriptsDir, `${videoName}.txt`);
    writeFileSync(transcriptPath, transcript, 'utf-8');

    // Update video status in database
    updateVideoStatus(video.id, 'transcribed');

    spinner.succeed(`Transcribed ${chalk.cyan(video.original_name)} (OpenAI API)`);

    return {
      transcribed: true,
      transcriptPath,
      transcript,
    };
  } catch (error) {
    // Handle specific API errors with clear messages
    let message = 'Unknown error';
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401) {
        message = 'Invalid OpenAI API key. Please check your OPENAI_API_KEY environment variable.';
      } else if (error.status === 429) {
        message = 'OpenAI API rate limit exceeded. Please try again later.';
      } else if (error.status === 413) {
        message = 'Audio file too large for OpenAI API. Maximum file size is 25MB.';
      } else {
        message = `OpenAI API error: ${error.message}`;
      }
    } else if (error instanceof Error) {
      message = error.message;
    }

    spinner.fail(`Failed to transcribe ${chalk.cyan(video.original_name)}: ${message}`);
    throw new Error(message);
  }
}

/**
 * Transcribe audio from a video using local Whisper
 * @param video - The video record to transcribe
 * @param audioPath - Path to the audio file
 * @param transcriptsDir - Directory to save the transcript
 * @param model - Whisper model to use (default: base)
 * @returns Result containing whether transcription occurred and the transcript content
 */
async function transcribeWithLocal(
  video: VideoRecord,
  audioPath: string,
  transcriptsDir: string,
  model: WhisperModel = 'base'
): Promise<TranscriptionResult> {
  const spinner = ora({
    text: `Transcribing ${chalk.cyan(video.original_name)} with Whisper (${model})`,
    color: 'blue',
  }).start();

  try {
    const videoPath = video.original_path;
    const videoName = basename(videoPath, extname(videoPath));

    // Run Whisper transcription
    // Whisper outputs to the same directory as the input file by default
    // We use --output_dir to specify the transcripts directory
    // and --output_format txt to get plain text
    await execa('whisper', [
      audioPath,
      '--model', model,
      '--output_dir', transcriptsDir,
      '--output_format', 'txt',
    ]);

    // Whisper outputs the file with the audio file's basename
    // e.g., video-name.wav -> video-name.txt
    const whisperOutputPath = join(transcriptsDir, `${videoName}.txt`);

    // Read the transcript
    let transcript = '';
    if (existsSync(whisperOutputPath)) {
      transcript = readFileSync(whisperOutputPath, 'utf-8').trim();
    }

    // Update video status in database
    updateVideoStatus(video.id, 'transcribed');

    spinner.succeed(`Transcribed ${chalk.cyan(video.original_name)}`);

    return {
      transcribed: true,
      transcriptPath: whisperOutputPath,
      transcript,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(`Failed to transcribe ${chalk.cyan(video.original_name)}: ${message}`);
    throw error;
  }
}

/**
 * Transcribe audio from a video using local Whisper or OpenAI API
 * @param video - The video record to transcribe
 * @param hasAudio - Whether the video has an audio track (from audio extraction step)
 * @param options - Transcription options (mode: local, api, or skip)
 * @returns Result containing whether transcription occurred and the transcript content
 */
export async function transcribeAudio(
  video: VideoRecord,
  hasAudio: boolean,
  options: TranscriptionOptions = { mode: 'local' }
): Promise<TranscriptionResult> {
  const videoPath = video.original_path;

  // Skip transcription if mode is 'skip'
  if (options.mode === 'skip') {
    console.log(chalk.yellow(`  Skipping transcription for ${chalk.cyan(video.original_name)} (--whisper skip)`));
    updateVideoStatus(video.id, 'transcribed');
    return { transcribed: false, transcriptPath: null, transcript: null };
  }

  // Skip transcription if no audio
  if (!hasAudio) {
    console.log(chalk.yellow(`  Skipping transcription for ${chalk.cyan(video.original_name)} (no audio track)`));
    updateVideoStatus(video.id, 'transcribed');
    return { transcribed: false, transcriptPath: null, transcript: null };
  }

  // Get the audio file path
  const audioPath = getTempAudioPath(videoPath);

  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // Create transcripts directory if it doesn't exist
  const transcriptsDir = getTranscriptsDir(videoPath);
  if (!existsSync(transcriptsDir)) {
    mkdirSync(transcriptsDir, { recursive: true });
  }

  // Use API or local based on options
  if (options.mode === 'api') {
    return transcribeWithApi(video, audioPath, transcriptsDir);
  } else {
    return transcribeWithLocal(video, audioPath, transcriptsDir, options.model ?? 'base');
  }
}
