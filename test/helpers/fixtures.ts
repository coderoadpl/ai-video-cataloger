/**
 * Test fixtures and mock data generators
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

// Minimal valid JPEG (1x1 pixel red image) as base64
export const MINIMAL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAPwCwAB//9k=';

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

/**
 * Create a fake video file (just needs to exist with correct extension)
 */
export function createFakeVideoFile(dir: string, filename: string = 'test-video.mp4'): string {
  const videoPath = join(dir, filename);
  // Create a minimal file that looks like a video (just needs to exist)
  const fakeVideoContent = Buffer.alloc(1024, 0);
  writeFileSync(videoPath, fakeVideoContent);
  return videoPath;
}

/**
 * Create a non-video file
 */
export function createNonVideoFile(dir: string, filename: string = 'test.txt'): string {
  const filePath = join(dir, filename);
  writeFileSync(filePath, 'This is not a video file');
  return filePath;
}

/**
 * Create mock frame artifacts
 */
export function createMockFrames(
  testDir: string,
  videoName: string,
  frameCount: number = 3
): string {
  const baseName = basename(videoName, extname(videoName));
  const framesDir = join(testDir, 'frames', baseName);
  mkdirSync(framesDir, { recursive: true });

  const frameBuffer = Buffer.from(MINIMAL_JPEG_BASE64, 'base64');
  for (let i = 1; i <= frameCount; i++) {
    const framePath = join(framesDir, `frame-${String(i).padStart(3, '0')}.jpg`);
    writeFileSync(framePath, frameBuffer);
  }

  return framesDir;
}

/**
 * Create mock transcript artifact
 */
export function createMockTranscript(
  testDir: string,
  videoName: string,
  content: string = 'This is a sample transcript for testing purposes.'
): string {
  const baseName = basename(videoName, extname(videoName));
  const transcriptsDir = join(testDir, 'transcripts');
  mkdirSync(transcriptsDir, { recursive: true });
  const transcriptPath = join(transcriptsDir, `${baseName}.txt`);
  writeFileSync(transcriptPath, content);
  return transcriptPath;
}

/**
 * Create mock summary artifacts (machine-readable .json + human-readable .txt)
 */
export function createMockSummary(
  testDir: string,
  videoName: string,
  options?: {
    description?: string;
    suggestedFilename?: string;
    fullAnalysis?: string;
  }
): string {
  const baseName = basename(videoName, extname(videoName));
  const summariesDir = join(testDir, 'summaries');
  mkdirSync(summariesDir, { recursive: true });

  const description = options?.description ?? 'A sample test video showing placeholder content.';
  const suggestedFilename = options?.suggestedFilename ?? 'sample-test-content';
  const fullAnalysis =
    options?.fullAnalysis ?? `DESCRIPTION: ${description}\nFILENAME: ${suggestedFilename}`;
  const analyzedAt = new Date().toISOString();

  // Machine-readable summary (source of truth)
  const summaryJsonPath = join(summariesDir, `${baseName}.json`);
  writeFileSync(
    summaryJsonPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        description,
        suggestedFilename,
        fullAnalysis,
        analyzedAt,
      },
      null,
      2
    )
  );

  // Human-readable summary rendered from the same data
  const summaryContent = `Video: ${videoName}
Date Analyzed: ${analyzedAt}

DESCRIPTION:
${description}

SUGGESTED FILENAME:
${suggestedFilename}

FULL ANALYSIS:
${fullAnalysis}
`;

  const summaryPath = join(summariesDir, `${baseName}.txt`);
  writeFileSync(summaryPath, summaryContent);
  return summaryPath;
}

/**
 * Create the database directory (needed before CLI can initialize)
 */
export function createDbDir(testDir: string): string {
  const dbDir = join(testDir, '.ai-video-cataloger');
  mkdirSync(dbDir, { recursive: true });
  return dbDir;
}

/**
 * Create all mock artifacts for a video
 */
export function createAllMockArtifacts(
  testDir: string,
  videoName: string
): {
  framesDir: string;
  transcriptPath: string;
  summaryPath: string;
  dbDir: string;
} {
  return {
    framesDir: createMockFrames(testDir, videoName),
    transcriptPath: createMockTranscript(testDir, videoName),
    summaryPath: createMockSummary(testDir, videoName),
    dbDir: createDbDir(testDir),
  };
}

/**
 * Create a subdirectory
 */
export function createSubDir(parentDir: string, name: string): string {
  const subDir = join(parentDir, name);
  mkdirSync(subDir, { recursive: true });
  return subDir;
}

/**
 * Create a nested .ai-video-cataloger folder (for check command tests)
 */
export function createNestedDatabase(testDir: string, subfolderPath: string): string {
  const nestedDbDir = join(testDir, subfolderPath, '.ai-video-cataloger');
  mkdirSync(nestedDbDir, { recursive: true });
  return nestedDbDir;
}
