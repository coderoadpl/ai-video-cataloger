/**
 * Transcription service
 * Transcribes audio using local Whisper
 */

import { execa } from 'execa';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { updateVideoStatus } from '../db/index.js';
import { getTempAudioPath } from './audio.js';
import type { VideoRecord } from '../types/index.js';

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

/**
 * Transcribe audio from a video using local Whisper
 * @param video - The video record to transcribe
 * @param hasAudio - Whether the video has an audio track (from audio extraction step)
 * @returns Result containing whether transcription occurred and the transcript content
 */
export async function transcribeAudio(
  video: VideoRecord,
  hasAudio: boolean
): Promise<TranscriptionResult> {
  const videoPath = video.original_path;

  // Skip transcription if no audio
  if (!hasAudio) {
    console.log(chalk.yellow(`  Skipping transcription for ${chalk.cyan(video.original_name)} (no audio track)`));
    updateVideoStatus(video.id, 'transcribed');
    return { transcribed: false, transcriptPath: null, transcript: null };
  }

  const spinner = ora({
    text: `Transcribing ${chalk.cyan(video.original_name)} with Whisper`,
    color: 'blue',
  }).start();

  try {
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

    // Run Whisper transcription
    // Whisper outputs to the same directory as the input file by default
    // We use --output_dir to specify the transcripts directory
    // and --output_format txt to get plain text
    const videoName = basename(videoPath, extname(videoPath));

    await execa('whisper', [
      audioPath,
      '--model', 'base',
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
