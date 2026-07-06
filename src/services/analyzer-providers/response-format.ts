/**
 * Shared response contract for ALL analyzer providers.
 *
 * Every provider instructs its model to answer in the exact format:
 *   DESCRIPTION: <2-3 sentences>
 *   FILENAME: <kebab-case-slug>
 * and this is the single parser/validator for that contract. A response
 * without an extractable FILENAME fails hard (ANALYSIS_PARSE_FAILED) - the
 * pipeline must never rename a user's file based on an unparseable answer.
 */

import { CodedError } from '../json-output.js';

export interface AnalysisResult {
  description: string;
  suggestedFilename: string;
  fullAnalysis: string;
}

export function parseAnalysisResponse(response: string): AnalysisResult {
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

  // No FILENAME line could be extracted - fail instead of inventing a name
  if (!suggestedFilename) {
    throw new CodedError(
      'Failed to parse analysis response: no FILENAME line found',
      'ANALYSIS_PARSE_FAILED'
    );
  }

  // Soft fallback: a FILENAME was found but no DESCRIPTION - use the response start
  if (!description) {
    description = response.trim().substring(0, 500);
  }

  return {
    description: description.trim(),
    suggestedFilename,
    fullAnalysis: response,
  };
}

/** The shared instruction block appended to every provider's prompt. */
export function responseContractInstructions(hasTranscript: boolean): string {
  return `Based on the visual content from the frames${hasTranscript ? ' and the audio transcript' : ''}, please provide:

1. A 2-3 sentence description of what this video is about
2. A suggested filename (3-5 words, kebab-case format like "cat-playing-with-yarn")

Please format your response EXACTLY as follows:
DESCRIPTION: <your 2-3 sentence description here>
FILENAME: <your-suggested-filename-in-kebab-case>

Focus on being descriptive and accurate. The filename should capture the essence of the video content.`;
}
