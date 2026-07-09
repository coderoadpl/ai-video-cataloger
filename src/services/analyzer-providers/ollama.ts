/**
 * Local analyzer provider backed by the managed Ollama runtime.
 * One multimodal model handles frames + transcript in a single prompt with
 * the same DESCRIPTION:/FILENAME: contract as the claude provider.
 */

import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { CodedError } from '../json-output.js';
import { ensureLocalRuntime } from '../ollama-setup.js';
import { chatVision, isModelInstalled } from '../ollama-client.js';
import { responseContractInstructions } from './response-format.js';
import type { AnalyzerInput, AnalyzerProvider } from './types.js';

function buildPrompt(videoName: string, transcript: string | null, frameCount: number): string {
  let prompt = `You are analyzing a video file named "${videoName}".\n\n`;

  if (transcript) {
    prompt += `Here is the transcript of the audio:\n---\n${transcript}\n---\n\n`;
  } else {
    prompt += `This video has no audio or transcript available.\n\n`;
  }

  prompt += `Attached are ${frameCount} frame(s) extracted from the video (as images).\n\n`;
  prompt += responseContractInstructions(transcript !== null);

  return prompt;
}

export class OllamaProvider implements AnalyzerProvider {
  readonly id = 'local' as const;
  readonly label: string;

  constructor(private readonly model: string) {
    this.label = `${model} (local)`;
  }

  async analyze(input: AnalyzerInput): Promise<{ rawResponse: string }> {
    const { videoName, framePaths, transcript, timeoutMs, verbose } = input;

    const { baseUrl } = await ensureLocalRuntime((event) => {
      if (verbose) {
        console.log(chalk.gray(`[local-ai] ${event.status}`));
      }
    });

    if (!(await isModelInstalled(baseUrl, this.model))) {
      throw new CodedError(
        `Local AI model "${this.model}" is not installed. ` +
        `Run: ai-video-cataloger models pull ${this.model}`,
        'MODEL_NOT_INSTALLED'
      );
    }

    const prompt = buildPrompt(videoName, transcript, framePaths.length);
    const imagesBase64 = framePaths.map((framePath) =>
      readFileSync(framePath).toString('base64')
    );

    if (verbose) {
      console.log(chalk.gray(`[verbose] Local analysis via ${baseUrl} model ${this.model}`));
      console.log(chalk.gray(`[verbose] ${framePaths.length} frame(s), prompt below:`));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.gray(prompt));
      console.log(chalk.gray('─'.repeat(60)));
    }

    const rawResponse = await chatVision(baseUrl, {
      model: this.model,
      prompt,
      imagesBase64,
      timeoutMs,
    });

    if (verbose) {
      console.log(chalk.gray('[verbose] Local model response:'));
      console.log(chalk.gray(rawResponse));
    }

    return { rawResponse };
  }
}
