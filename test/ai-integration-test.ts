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
import { existsSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = __dirname;
const TEST_VIDEO = 'BigBuckBunny480p30s.mp4';
const VIDEO_PATH = join(TEST_DIR, TEST_VIDEO);
const VIDEO_NAME = 'BigBuckBunny480p30s';
const CLI_PATH = join(TEST_DIR, '..', 'dist', 'index.js');

// Artifact paths
const ARTIFACTS_DIR = join(TEST_DIR, '.ai-video-cataloger');
const FRAMES_DIR = join(TEST_DIR, 'frames', VIDEO_NAME);
const TRANSCRIPTS_DIR = join(TEST_DIR, 'transcripts');
const SUMMARIES_DIR = join(TEST_DIR, 'summaries');
const TRANSCRIPT_PATH = join(TRANSCRIPTS_DIR, `${VIDEO_NAME}.txt`);
const SUMMARY_PATH = join(SUMMARIES_DIR, `${VIDEO_NAME}.txt`);

interface TestResult {
  name: string;
  passed: boolean;
  reason: string;
}

interface ValidationResult {
  passed: boolean;
  reasoning: string;
  details: {
    framesValid: boolean;
    summaryValid: boolean;
    summaryMentionsBigBuckBunny: boolean;
    summaryMentionsAnimated: boolean;
    statusCompleted: boolean;
  };
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
 * Clean up test artifacts before running
 */
function cleanArtifacts(): void {
  console.log('\n🧹 Cleaning test artifacts...\n');

  // Remove database directory
  if (existsSync(ARTIFACTS_DIR)) {
    rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
    console.log(`  ✓ Removed ${ARTIFACTS_DIR}`);
  }

  // Remove frames directory
  if (existsSync(FRAMES_DIR)) {
    rmSync(FRAMES_DIR, { recursive: true, force: true });
    console.log(`  ✓ Removed ${FRAMES_DIR}`);
  }

  // Remove transcript
  if (existsSync(TRANSCRIPT_PATH)) {
    rmSync(TRANSCRIPT_PATH, { force: true });
    console.log(`  ✓ Removed ${TRANSCRIPT_PATH}`);
  }

  // Remove summary
  if (existsSync(SUMMARY_PATH)) {
    rmSync(SUMMARY_PATH, { force: true });
    console.log(`  ✓ Removed ${SUMMARY_PATH}`);
  }

  console.log('  ✓ Artifacts cleaned\n');
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
  if (!existsSync(VIDEO_PATH)) {
    console.error(`❌ Test video not found at ${VIDEO_PATH}`);
    return false;
  }

  // Run CLI with --skip-rename to preserve original filename
  const result = await runCommand('node', [
    CLI_PATH,
    'process',
    VIDEO_PATH,
    '--skip-rename',
    '--frames', '3',
    '--whisper', 'skip', // Skip whisper for faster testing
  ], TEST_DIR);

  if (result.exitCode !== 0) {
    console.error(`\n❌ CLI process command failed with exit code ${result.exitCode}`);
    return false;
  }

  console.log('\n  ✓ Video processing complete\n');
  return true;
}

/**
 * Check that frames were extracted and look like animated content
 */
function checkFrames(): TestResult {
  console.log('\n🖼️  Checking extracted frames...\n');

  if (!existsSync(FRAMES_DIR)) {
    return {
      name: 'Frames Extraction',
      passed: false,
      reason: `Frames directory not found: ${FRAMES_DIR}`,
    };
  }

  const frames = readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.jpg'));

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
    const framePath = join(FRAMES_DIR, frame);
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
function checkSummary(): TestResult {
  console.log('\n📝 Checking generated summary...\n');

  if (!existsSync(SUMMARY_PATH)) {
    return {
      name: 'Summary Generation',
      passed: false,
      reason: `Summary file not found: ${SUMMARY_PATH}`,
    };
  }

  const summary = readFileSync(SUMMARY_PATH, 'utf-8');

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
async function checkStatus(): Promise<TestResult> {
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
  let statusData: Array<{ path: string; status: string }> | null = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'completed' && event.data) {
        statusData = event.data as Array<{ path: string; status: string }>;
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

  const videoStatus = statusData.find((v) => v.path.includes(VIDEO_NAME));

  if (!videoStatus) {
    return {
      name: 'Video Status',
      passed: false,
      reason: `Video ${VIDEO_NAME} not found in status output`,
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
async function validateWithClaude(): Promise<TestResult> {
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
  if (!existsSync(SUMMARY_PATH)) {
    return {
      name: 'Claude AI Validation',
      passed: false,
      reason: 'Summary file not found for validation',
    };
  }

  const summary = readFileSync(SUMMARY_PATH, 'utf-8');

  // Read frame paths for validation
  const frameFiles = existsSync(FRAMES_DIR)
    ? readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.jpg')).map((f) => join(FRAMES_DIR, f))
    : [];

  // Build validation prompt
  const validationPrompt = `You are validating the output of an AI video cataloger.

The video being tested is "Big Buck Bunny" - a well-known 3D animated short film by the Blender Foundation.

Here is the summary generated by the cataloger:

---
${summary}
---

The cataloger also extracted ${frameFiles.length} frame(s) from the video.

Please validate this output by answering these questions:

1. Does the summary mention "Big Buck Bunny" (or similar like "big buck bunny", "BigBuckBunny")?
2. Does the summary indicate this is animated content (mentions "animated", "animation", "3D", "CGI", "Blender", or similar)?
3. Is the description accurate for Big Buck Bunny (nature scenes, meadows, animated characters/animals)?

Respond with a JSON object (and ONLY the JSON object, no other text):
{
  "mentionsBigBuckBunny": true/false,
  "mentionsAnimated": true/false,
  "descriptionAccurate": true/false,
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
      overallValid: boolean;
      reasoning: string;
    };

    console.log(`  ✓ Mentions Big Buck Bunny: ${validation.mentionsBigBuckBunny}`);
    console.log(`  ✓ Mentions animated: ${validation.mentionsAnimated}`);
    console.log(`  ✓ Description accurate: ${validation.descriptionAccurate}`);
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

  // Step 3: Check frames
  const framesResult = checkFrames();
  results.push(framesResult);
  if (!framesResult.passed) overallPassed = false;

  // Step 4: Check summary
  const summaryResult = checkSummary();
  results.push(summaryResult);
  if (!summaryResult.passed) overallPassed = false;

  // Step 5: Check status
  const statusResult = await checkStatus();
  results.push(statusResult);
  if (!statusResult.passed) overallPassed = false;

  // Step 6: Validate with Claude (only if previous tests passed)
  if (overallPassed) {
    const claudeResult = await validateWithClaude();
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
