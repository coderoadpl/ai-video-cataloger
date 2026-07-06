/**
 * Claude Code CLI analyzer provider - the original analysis path, moved 1:1
 * from analyzer.ts. Frames are referenced as file:// URLs in the prompt and
 * --add-dir grants Claude read access to the video's directory.
 */

import { execa } from 'execa';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { getFilteredEnv } from '../env-filter.js';
import { responseContractInstructions } from './response-format.js';
import type { AnalyzerInput, AnalyzerProvider } from './types.js';

/**
 * Convert a file path to Claude's project folder name format.
 * Claude stores conversations in ~/.claude/projects/-<path-with-dashes>
 */
function getClaudeProjectFolderName(dirPath: string): string {
  return '-' + dirPath.replace(/\//g, '-').replace(/^-/, '');
}

/**
 * Clear Claude Code conversation history for a directory.
 * This prevents SIGTRAP errors caused by corrupted or too-large conversation contexts.
 */
function clearClaudeConversationHistory(dirPath: string): void {
  const claudeProjectsDir = join(homedir(), '.claude', 'projects');
  const projectPath = join(claudeProjectsDir, getClaudeProjectFolderName(dirPath));

  if (existsSync(projectPath)) {
    try {
      rmSync(projectPath, { recursive: true, force: true });
    } catch {
      // Ignore errors - conversation history is not critical
    }
  }
}

function buildPrompt(videoName: string, transcript: string | null, framePaths: string[]): string {
  let prompt = `You are analyzing a video file named "${videoName}".\n\n`;

  if (transcript) {
    prompt += `Here is the transcript of the audio:\n---\n${transcript}\n---\n\n`;
  } else {
    prompt += `This video has no audio or transcript available.\n\n`;
  }

  // Include frame images using file:// URLs so Claude can view them
  prompt += `Here are ${framePaths.length} frame(s) extracted from the video:\n`;
  for (const framePath of framePaths) {
    prompt += `file://${framePath}\n`;
  }
  prompt += `\n`;
  prompt += responseContractInstructions(transcript !== null);

  return prompt;
}

export class ClaudeCliProvider implements AnalyzerProvider {
  readonly id = 'claude' as const;
  readonly label = 'Claude';

  async analyze(input: AnalyzerInput): Promise<{ rawResponse: string }> {
    const { videoName, videoDir, framePaths, transcript, timeoutMs, verbose } = input;
    const prompt = buildPrompt(videoName, transcript, framePaths);

    if (verbose) {
      console.log(chalk.gray('\n[verbose] Frame paths being analyzed:'));
      for (const framePath of framePaths) {
        console.log(chalk.gray(`  • ${framePath}`));
      }
      console.log(chalk.gray('\n[verbose] Full prompt being sent to Claude:'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.gray(prompt));
      console.log(chalk.gray('─'.repeat(60)));
      console.log();
    }

    // Clear Claude conversation history to prevent SIGTRAP errors from corrupted contexts
    clearClaudeConversationHistory(videoDir);

    const args = ['--add-dir', videoDir, '-p', prompt];
    let response = '';

    if (verbose) {
      console.log(chalk.gray(`[verbose] Running: claude --add-dir "${videoDir}" -p "<prompt>"`));
      console.log(chalk.gray('[verbose] Claude response (streaming):'));
      console.log(chalk.gray('─'.repeat(60)));

      // stdin: 'ignore' prevents waiting for input
      const subprocess = execa('claude', args, { timeout: timeoutMs, stdin: 'ignore', env: getFilteredEnv() });

      subprocess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        process.stdout.write(chalk.gray(chunk));
        response += chunk;
      });
      subprocess.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(chalk.red('[stderr] ' + data.toString()));
      });

      await subprocess;

      console.log(chalk.gray('\n' + '─'.repeat(60)));
      console.log();
    } else {
      const result = await execa('claude', args, { timeout: timeoutMs, stdin: 'ignore', env: getFilteredEnv() });
      response = result.stdout;
    }

    return { rawResponse: response };
  }
}
