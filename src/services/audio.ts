/**
 * Audio extraction service
 * Extracts audio track from videos using ffmpeg
 */

import ffmpeg from 'fluent-ffmpeg';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import { updateVideoStatus } from '../db/index.js';
import type { VideoRecord } from '../types/index.js';

/**
 * Check if a video has an audio track
 */
function hasAudioTrack(videoPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const audioStreams = metadata.streams.filter(
        (stream) => stream.codec_type === 'audio'
      );
      resolve(audioStreams.length > 0);
    });
  });
}

/**
 * Extract audio from video to WAV file
 */
function extractAudioToWav(
  videoPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Get the temp audio directory for storing extracted audio files
 */
export function getTempAudioDir(): string {
  const tempDir = join(tmpdir(), 'ai-video-cataloger', 'audio');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Get the temp audio file path for a video
 */
export function getTempAudioPath(videoPath: string): string {
  const videoName = basename(videoPath, extname(videoPath));
  return join(getTempAudioDir(), `${videoName}.wav`);
}

/**
 * Clean up a temporary audio file
 */
export function cleanupTempAudio(audioPath: string): void {
  try {
    if (existsSync(audioPath)) {
      unlinkSync(audioPath);
    }
  } catch {
    // Best effort cleanup, ignore errors
  }
}

export interface AudioExtractionResult {
  hasAudio: boolean;
  audioPath: string | null;
}

/**
 * Extract audio from a video file
 * @param video - The video record to extract audio from
 * @returns Result containing whether audio exists and path to extracted audio
 */
export async function extractAudio(
  video: VideoRecord
): Promise<AudioExtractionResult> {
  const videoPath = video.original_path;

  const spinner = ora({
    text: `Checking audio track in ${chalk.cyan(video.original_name)}`,
    color: 'blue',
  }).start();

  try {
    // Check if video has audio track
    const hasAudio = await hasAudioTrack(videoPath);

    if (!hasAudio) {
      spinner.warn(`No audio track found in ${chalk.cyan(video.original_name)} - will skip transcription`);
      updateVideoStatus(video.id, 'audio_extracted');
      return { hasAudio: false, audioPath: null };
    }

    // Extract audio to temp WAV file
    const audioPath = getTempAudioPath(videoPath);

    spinner.text = `Extracting audio from ${chalk.cyan(video.original_name)}`;

    await extractAudioToWav(videoPath, audioPath);

    // Update video status in database
    updateVideoStatus(video.id, 'audio_extracted');

    spinner.succeed(`Extracted audio from ${chalk.cyan(video.original_name)}`);

    return { hasAudio: true, audioPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(`Failed to extract audio from ${chalk.cyan(video.original_name)}: ${message}`);
    throw error;
  }
}
