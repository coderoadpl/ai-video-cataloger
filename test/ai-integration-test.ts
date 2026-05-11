#!/usr/bin/env npx tsx

/**
 * AI Integration Test for AI Video Cataloger
 *
 * This test script validates the CLI's ability to correctly process a video file
 * and generate meaningful AI-powered analysis. It uses the Claude Code CLI to
 * validate that the output meets expectations.
 *
 * IMPORTANT: This test is intended for manual execution only, not CI.
 * It requires:
 * - Claude Code CLI to be available (`claude` command)
 * - BigBuckBunny480p30s.mp4 test video in the test/ directory
 * - Sufficient compute resources for video processing
 *
 * Usage:
 *   npm run build && npx tsx test/ai-integration-test.ts
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, rmSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = __dirname;
const ORIGINAL_VIDEO_NAME = 'BigBuckBunny480p30s.mp4';
const ORIGINAL_VIDEO_PATH = join(TEST_DIR, ORIGINAL_VIDEO_NAME);
const CLI_PATH = join(TEST_DIR, '..', 'dist', 'index.js');

// Base directories for artifacts
const ARTIFACTS_DIR = join(TEST_DIR, '.ai-video-cataloger');
const FRAMES_BASE_DIR = join(TEST_DIR, 'frames');
const TRANSCRIPTS_DIR = join(TEST_DIR, 'transcripts');
const SUMMARIES_DIR = join(TEST_DIR, 'summaries');

interface TestResult {
  name: string;
  passed: boolean;
  reason: string;
}

interface ProcessedVideoInfo {
  originalName: string;
  newName: string;
  newPath: string;
  baseName: string; // filename without extension
}

/**
 * Run a command and return stdout
 */
function runCommand(command: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: cwd || TEST_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

/**
 * Find all video files in test directory
 */
function findVideoFiles(): string[] {
  const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  return readdirSync(TEST_DIR).filter(f => {
    const ext = extname(f).toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
  });
}

/**
 * Restore original video name if it was renamed
 */
function restoreOriginalVideo(): void {
  const videoFiles = findVideoFiles();

  // If original exists, nothing to do
  if (videoFiles.includes(ORIGINAL_VIDEO_NAME)) {
    return;
  }

  // Find any renamed video and restore it
  if (videoFiles.length === 1 && videoFiles[0] !== ORIGINAL_VIDEO_NAME) {
    const renamedPath = join(TEST_DIR, videoFiles[0]);
    console.log(`  Restoring ${videoFiles[0]} -> ${ORIGINAL_VIDEO_NAME}`);
    renameSync(renamedPath, ORIGINAL_VIDEO_PATH);
  }
}

/**
 * Clean up test artifacts before running
 */
function cleanArtifacts(): void {
  console.log('\n🧹 Cleaning test artifacts...\n');

  // Restore original video name first
  restoreOriginalVideo();

  // Remove database directory
  if (existsSync(ARTIFACTS_DIR)) {
    rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
    console.log(`  ✓ Removed ${ARTIFACTS_DIR}`);
  }

  // Remove frames directory (all subdirs)
  if (existsSync(FRAMES_BASE_DIR)) {
    rmSync(FRAMES_BASE_DIR, { recursive: true, force: true });
    console.log(`  ✓ Removed ${FRAMES_BASE_DIR}`);
  }

  // Remove transcripts directory
  if (existsSync(TRANSCRIPTS_DIR)) {
    rmSync(TRANSCRIPTS_DIR, { recursive: true, force: true });
    console.log(`  ✓ Removed ${TRANSCRIPTS_DIR}`);
  }

  // Remove summaries directory
  if (existsSync(SUMMARIES_DIR)) {
    rmSync(SUMMARIES_DIR, { recursive: true, force: true });
    console.log(`  ✓ Removed ${SUMMARIES_DIR}`);
  }

  console.log('  ✓ Artifacts cleaned\n');
}

/**
 * Find the processed video (may have been renamed)
 */
function findProcessedVideo(): ProcessedVideoInfo | null {
  const videoFiles = findVideoFiles();

  if (videoFiles.length === 0) {
    return null;
  }

  // Find the video (might be renamed or original)
  const videoFile = videoFiles[0];
  const baseName = basename(videoFile, extname(videoFile));

  return {
    originalName: ORIGINAL_VIDEO_NAME,
    newName: videoFile,
    newPath: join(TEST_DIR, videoFile),
    baseName,
  };
}

/**
 * Run the CLI to process the test video
 */
async function processVideo(): Promise<boolean> {
  console.log('\n📹 Processing test video with CLI...\n');

  // Check CLI exists
  if (!existsSync(CLI_PATH)) {
    console.error(`❌ CLI not found at ${CLI_PATH}`);
    console.error('   Run "npm run build" first');
    return false;
  }

  // Check video exists
  if (!existsSync(ORIGINAL_VIDEO_PATH)) {
    console.error(`❌ Test video not found at ${ORIGINAL_VIDEO_PATH}`);
    return false;
  }

  // Run CLI - let it rename the file (this is part of what we're testing!)
  const result = await runCommand('node', [
    CLI_PATH,
    'process',
    ORIGINAL_VIDEO_PATH,
    '--frames', '3',
  ], TEST_DIR);

  if (result.exitCode !== 0) {
    console.error(`\n❌ CLI process command failed with exit code ${result.exitCode}`);
    return false;
  }

  console.log('\n  ✓ Video processing complete\n');
  return true;
}

/**
 * Check that the video was renamed sensibly
 */
function checkRename(videoInfo: ProcessedVideoInfo): TestResult {
  console.log('\n📛 Checking video rename...\n');

  const { originalName, newName, baseName } = videoInfo;

  // If not renamed, that's okay but note it
  if (newName === originalName) {
    return {
      name: 'Video Rename',
      passed: true,
      reason: 'Video was not renamed (may indicate --skip-rename or same suggested name)',
    };
  }

  console.log(`  ✓ Video renamed: ${originalName} -> ${newName}`);

  // Check if the new name is sensible for Big Buck Bunny
  const lowerName = baseName.toLowerCase();
  const containsBunny = lowerName.includes('bunny') || lowerName.includes('buck');
  const hasDatePrefix = /^\d{4}-\d{2}-\d{2}/.test(baseName);

  console.log(`  ✓ Contains 'bunny' or 'buck': ${containsBunny}`);
  console.log(`  ✓ Has date prefix: ${hasDatePrefix}`);

  if (!containsBunny) {
    return {
      name: 'Video Rename',
      passed: false,
      reason: `New filename "${newName}" doesn't reference Big Buck Bunny content`,
    };
  }

  return {
    name: 'Video Rename',
    passed: true,
    reason: `Video sensibly renamed to: ${newName}`,
  };
}

/**
 * Check that frames were extracted
 */
function checkFrames(videoInfo: ProcessedVideoInfo): TestResult {
  console.log('\n🖼️  Checking extracted frames...\n');

  const framesDir = join(FRAMES_BASE_DIR, videoInfo.baseName);

  if (!existsSync(framesDir)) {
    // Try to find any frames directory
    if (existsSync(FRAMES_BASE_DIR)) {
      const frameDirs = readdirSync(FRAMES_BASE_DIR);
      if (frameDirs.length > 0) {
        console.log(`  Note: Found frames in ${frameDirs[0]} instead of ${videoInfo.baseName}`);
      }
    }
    return {
      name: 'Frames Extraction',
      passed: false,
      reason: `Frames directory not found: ${framesDir}`,
    };
  }

  const frames = readdirSync(framesDir).filter((f) => f.endsWith('.jpg'));

  if (frames.length === 0) {
    return {
      name: 'Frames Extraction',
      passed: false,
      reason: 'No frame images found',
    };
  }

  console.log(`  ✓ Found ${frames.length} frame(s): ${frames.join(', ')}`);

  // Verify frames are actual images (non-empty files)
  for (const frame of frames) {
    const framePath = join(framesDir, frame);
    const stats = readFileSync(framePath);
    if (stats.length < 1000) {
      return {
        name: 'Frames Extraction',
        passed: false,
        reason: `Frame ${frame} appears to be invalid (size: ${stats.length} bytes)`,
      };
    }
    console.log(`  ✓ ${frame}: ${stats.length} bytes`);
  }

  return {
    name: 'Frames Extraction',
    passed: true,
    reason: `Successfully extracted ${frames.length} valid frame(s)`,
  };
}

/**
 * Check that a summary was generated with expected content
 */
function checkSummary(videoInfo: ProcessedVideoInfo): TestResult {
  console.log('\n📝 Checking generated summary...\n');

  const summaryPath = join(SUMMARIES_DIR, `${videoInfo.baseName}.txt`);

  if (!existsSync(summaryPath)) {
    // Try to find any summary file
    if (existsSync(SUMMARIES_DIR)) {
      const summaryFiles = readdirSync(SUMMARIES_DIR).filter(f => f.endsWith('.txt'));
      if (summaryFiles.length > 0) {
        console.log(`  Note: Found summary ${summaryFiles[0]} instead of ${videoInfo.baseName}.txt`);
      }
    }
    return {
      name: 'Summary Generation',
      passed: false,
      reason: `Summary file not found: ${summaryPath}`,
    };
  }

  const summary = readFileSync(summaryPath, 'utf-8');

  if (summary.length < 100) {
    return {
      name: 'Summary Generation',
      passed: false,
      reason: `Summary too short (${summary.length} characters)`,
    };
  }

  console.log(`  ✓ Summary file exists (${summary.length} characters)`);

  // Check for required sections
  const hasDescription = summary.includes('DESCRIPTION:');
  const hasFilename = summary.includes('SUGGESTED FILENAME:') || summary.includes('FILENAME:');
  const hasAnalysis = summary.includes('FULL ANALYSIS:') || summary.includes('ANALYSIS:');

  console.log(`  ✓ Has DESCRIPTION section: ${hasDescription}`);
  console.log(`  ✓ Has FILENAME section: ${hasFilename}`);
  console.log(`  ✓ Has ANALYSIS section: ${hasAnalysis}`);

  if (!hasDescription) {
    return {
      name: 'Summary Generation',
      passed: false,
      reason: 'Summary missing DESCRIPTION section',
    };
  }

  return {
    name: 'Summary Generation',
    passed: true,
    reason: 'Summary generated with expected sections',
  };
}

/**
 * Check video status in database
 */
async function checkStatus(videoInfo: ProcessedVideoInfo): Promise<TestResult> {
  console.log('\n📊 Checking video status in database...\n');

  const result = await runCommand('node', [
    CLI_PATH,
    'status',
    '--json',
  ], TEST_DIR);

  if (result.exitCode !== 0) {
    return {
      name: 'Video Status',
      passed: false,
      reason: `Status command failed with exit code ${result.exitCode}`,
    };
  }

  // Parse NDJSON output - look for completed event
  const lines = result.stdout.trim().split('\n');
  let statusData: Array<{ path: string; status: string; newName?: string }> | null = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'completed' && event.data?.videos) {
        statusData = event.data.videos as Array<{ path: string; status: string; newName?: string }>;
        break;
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  if (!statusData) {
    return {
      name: 'Video Status',
      passed: false,
      reason: 'Could not parse status data from JSON output',
    };
  }

  // Find video by original path or new name
  const videoStatus = statusData.find((v) =>
    v.path.includes(videoInfo.baseName) ||
    v.path.includes('BigBuckBunny') ||
    v.newName?.includes(videoInfo.baseName)
  );

  if (!videoStatus) {
    return {
      name: 'Video Status',
      passed: false,
      reason: `Video not found in status output`,
    };
  }

  console.log(`  ✓ Video status: ${videoStatus.status}`);

  if (videoStatus.status !== 'completed') {
    return {
      name: 'Video Status',
      passed: false,
      reason: `Expected status 'completed', got '${videoStatus.status}'`,
    };
  }

  return {
    name: 'Video Status',
    passed: true,
    reason: 'Video status is completed',
  };
}

/**
 * Use Claude Code CLI to validate the content
 */
async function validateWithClaude(videoInfo: ProcessedVideoInfo): Promise<TestResult> {
  console.log('\n🤖 Validating output with Claude Code CLI...\n');

  // Check Claude CLI is available
  try {
    execSync('which claude', { stdio: 'pipe' });
  } catch {
    return {
      name: 'Claude AI Validation',
      passed: false,
      reason: 'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code',
    };
  }

  // Read the summary
  const summaryPath = join(SUMMARIES_DIR, `${videoInfo.baseName}.txt`);
  if (!existsSync(summaryPath)) {
    return {
      name: 'Claude AI Validation',
      passed: false,
      reason: 'Summary file not found for validation',
    };
  }

  const summary = readFileSync(summaryPath, 'utf-8');

  // Read frame paths for validation
  const framesDir = join(FRAMES_BASE_DIR, videoInfo.baseName);
  const frameFiles = existsSync(framesDir)
    ? readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).map((f) => join(framesDir, f))
    : [];

  // Build validation prompt
  const validationPrompt = `You are validating the output of an AI video cataloger.

The video being tested is "Big Buck Bunny" - a well-known 3D animated short film by the Blender Foundation.

The video was renamed from "BigBuckBunny480p30s.mp4" to "${videoInfo.newName}".

Here is the summary generated by the cataloger:

---
${summary}
---

The cataloger also extracted ${frameFiles.length} frame(s) from the video.

Please validate this output by answering these questions:

1. Does the summary mention "Big Buck Bunny" (or similar like "big buck bunny", "BigBuckBunny")?
2. Does the summary indicate this is animated content (mentions "animated", "animation", "3D", "CGI", "Blender", or similar)?
3. Is the description accurate for Big Buck Bunny (nature scenes, meadows, animated characters/animals)?
4. Is the new filename "${videoInfo.newName}" a reasonable rename for Big Buck Bunny content?

Respond with a JSON object (and ONLY the JSON object, no other text):
{
  "mentionsBigBuckBunny": true/false,
  "mentionsAnimated": true/false,
  "descriptionAccurate": true/false,
  "renameReasonable": true/false,
  "overallValid": true/false,
  "reasoning": "Brief explanation"
}`;

  // Run Claude CLI with the validation prompt
  const result = await runCommand('claude', [
    '--print',
    '--output-format', 'text',
    validationPrompt,
  ]);

  if (result.exitCode !== 0) {
    return {
      name: 'Claude AI Validation',
      passed: false,
      reason: `Claude CLI failed with exit code ${result.exitCode}`,
    };
  }

  // Parse Claude's response
  try {
    // Extract JSON from response (Claude might add some surrounding text)
    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        name: 'Claude AI Validation',
        passed: false,
        reason: `Could not find JSON in Claude response: ${result.stdout.substring(0, 200)}`,
      };
    }

    const validation = JSON.parse(jsonMatch[0]) as {
      mentionsBigBuckBunny: boolean;
      mentionsAnimated: boolean;
      descriptionAccurate: boolean;
      renameReasonable: boolean;
      overallValid: boolean;
      reasoning: string;
    };

    console.log(`  ✓ Mentions Big Buck Bunny: ${validation.mentionsBigBuckBunny}`);
    console.log(`  ✓ Mentions animated: ${validation.mentionsAnimated}`);
    console.log(`  ✓ Description accurate: ${validation.descriptionAccurate}`);
    console.log(`  ✓ Rename reasonable: ${validation.renameReasonable}`);
    console.log(`  ✓ Overall valid: ${validation.overallValid}`);
    console.log(`  ✓ Claude's reasoning: ${validation.reasoning}`);

    if (!validation.overallValid) {
      return {
        name: 'Claude AI Validation',
        passed: false,
        reason: `Claude validation failed: ${validation.reasoning}`,
      };
    }

    // Build detailed failure messages if needed
    const failures: string[] = [];
    if (!validation.mentionsBigBuckBunny) {
      failures.push('Summary does not mention Big Buck Bunny');
    }
    if (!validation.mentionsAnimated) {
      failures.push('Summary does not indicate animated content');
    }
    if (!validation.descriptionAccurate) {
      failures.push('Description is not accurate for Big Buck Bunny');
    }
    if (!validation.renameReasonable) {
      failures.push('Filename rename is not reasonable');
    }

    if (failures.length > 0) {
      return {
        name: 'Claude AI Validation',
        passed: false,
        reason: failures.join('; '),
      };
    }

    return {
      name: 'Claude AI Validation',
      passed: true,
      reason: validation.reasoning,
    };
  } catch (error) {
    return {
      name: 'Claude AI Validation',
      passed: false,
      reason: `Failed to parse Claude response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('         AI Video Cataloger - Integration Test');
  console.log('═══════════════════════════════════════════════════════════');

  const results: TestResult[] = [];
  let overallPassed = true;

  // Step 1: Clean artifacts
  cleanArtifacts();

  // Step 2: Process video
  const processSuccess = await processVideo();
  if (!processSuccess) {
    console.error('\n❌ Video processing failed. Cannot continue with tests.\n');
    process.exit(1);
  }

  // Step 3: Find the processed video (may have been renamed)
  const videoInfo = findProcessedVideo();
  if (!videoInfo) {
    console.error('\n❌ Could not find processed video. Cannot continue with tests.\n');
    process.exit(1);
  }

  console.log(`\n📁 Found processed video: ${videoInfo.newName}`);
  console.log(`   Base name for artifacts: ${videoInfo.baseName}\n`);

  // Step 4: Check rename
  const renameResult = checkRename(videoInfo);
  results.push(renameResult);
  if (!renameResult.passed) overallPassed = false;

  // Step 5: Check frames
  const framesResult = checkFrames(videoInfo);
  results.push(framesResult);
  if (!framesResult.passed) overallPassed = false;

  // Step 6: Check summary
  const summaryResult = checkSummary(videoInfo);
  results.push(summaryResult);
  if (!summaryResult.passed) overallPassed = false;

  // Step 7: Check status
  const statusResult = await checkStatus(videoInfo);
  results.push(statusResult);
  if (!statusResult.passed) overallPassed = false;

  // Step 8: Validate with Claude (only if previous tests passed)
  if (overallPassed) {
    const claudeResult = await validateWithClaude(videoInfo);
    results.push(claudeResult);
    if (!claudeResult.passed) overallPassed = false;
  } else {
    results.push({
      name: 'Claude AI Validation',
      passed: false,
      reason: 'Skipped due to previous test failures',
    });
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                     Test Results');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    console.log(`   ${result.reason}\n`);
  }

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  console.log('═══════════════════════════════════════════════════════════');
  if (overallPassed) {
    console.log(`\n✅ All tests passed (${passedCount}/${totalCount})\n`);
  } else {
    console.log(`\n❌ Some tests failed (${passedCount}/${totalCount} passed)\n`);
  }
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(overallPassed ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
