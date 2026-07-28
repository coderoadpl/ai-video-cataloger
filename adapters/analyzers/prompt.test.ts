import { describe, expect, it } from 'vitest';

import { buildGeminiPrompt } from '@adapters/gemini/index.js';

import { buildAnalyzerPrompt } from './index.js';
import { ANALYSIS_PROMPT_VERSION, outputLanguageInstruction } from './prompt.js';

const retrievalMarkers = [
  'Write for retrieval',
  'signs, placards, banners, shop and street names, vehicle registrations, printed or on-screen dates, screens, labels, numbers',
  'Never invent names or facts',
  'Use proper nouns and quoted signage only when they are legibly readable on screen or clearly and audibly spoken',
  'otherwise use a generic descriptor such as "boat exhibit placard", never a guess',
  'never invent utterances, languages, or lyrics',
  'setting and location claims only when visually supported',
  'never reframe the visible setting as a different place',
  'uncertain audio generically as music or ambience, without language or genre claims unless unambiguous',
  'the distinctive text or names you verified from the frames or the audio',
  'must not lead with any proper noun or quoted signage that fails the legibly-readable-or-clearly-spoken evidence gate',
  'up to eight when the content earns them',
  'Never use filler words such as video, clip, footage, recording, scene or movie',
  'museum-exhibit',
  'tags that work as search handles',
  'notable text or proper nouns you read in frame',
];

const framePrompt = (outputLanguage: string): string =>
  buildAnalyzerPrompt({
    videoName: 'Clip.mp4',
    transcript: 'spoken words',
    framePaths: ['/frame.jpg'],
    frameMode: 'attached-images',
    outputLanguage,
  });

describe('retrieval-grade prompt', () => {
  it('pins the prompt version used by configuration identity', () => {
    expect(ANALYSIS_PROMPT_VERSION).toBe(1);
  });

  it.each(retrievalMarkers)('keeps "%s" in the frame-analyzer prompt', (marker) => {
    expect(framePrompt('auto')).toContain(marker);
  });

  it.each(retrievalMarkers)('keeps "%s" in the gemini prompt', (marker) => {
    expect(buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'auto' })).toContain(marker);
  });

  it('keeps the output contract the parser expects', () => {
    expect(framePrompt('auto')).toContain(
      'DESCRIPTION: <text>\nFILENAME: <kebab-case-name>\nTAGS: <tag-one>, <tag-two>, <tag-three>',
    );
  });

  it('shares one language directive between both prompts', () => {
    const directive = outputLanguageInstruction('pl');

    expect(directive).toBe(
      '\n\nWrite the DESCRIPTION and the FILENAME in Polish. Keep the TAGS in ASCII kebab-case English regardless of the description language.',
    );
    expect(framePrompt('pl')).toContain(directive);
    expect(buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'pl' })).toContain(directive);
    expect(outputLanguageInstruction('auto')).toBe('');
  });

  it('leaves the gemini transcript section untouched', () => {
    const prompt = buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'auto' });

    expect(prompt).toContain(
      'TRANSCRIPT: verbatim speech and on-screen text with timestamps, one segment per line formatted [MM:SS] text. If there is no speech at all, write exactly: NONE',
    );
  });
});
