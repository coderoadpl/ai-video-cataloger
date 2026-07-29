import { describe, expect, it } from 'vitest';

import { buildGeminiPrompt } from '@adapters/gemini/index.js';

import { buildAnalyzerPrompt } from './index.js';
import { ANALYSIS_PROMPT_VERSION, languageInstruction } from './prompt.js';

const retrievalMarkers = [
  'Write for retrieval',
  'signs, placards, banners, shop and street names, vehicle registrations, printed or on-screen dates, screens, labels, numbers',
  'Never invent names or facts',
  'the distinctive text or names you verified from the frames or the audio',
  'up to eight when the content earns them',
  'Never use filler words such as video, clip, footage, recording, scene or movie',
  'museum-exhibit',
  'tags that work as search handles',
  'notable text or proper nouns you read in frame',
];

const framePrompt = (outputLanguage: string, tagLanguage: string = outputLanguage): string =>
  buildAnalyzerPrompt({
    videoName: 'Clip.mp4',
    transcript: 'spoken words',
    framePaths: ['/frame.jpg'],
    frameMode: 'attached-images',
    outputLanguage,
    tagLanguage,
  });

describe('retrieval-grade prompt', () => {
  it('pins the prompt version used by configuration identity', () => {
    expect(ANALYSIS_PROMPT_VERSION).toBe(4);
  });

  it.each(retrievalMarkers)('keeps "%s" in the frame-analyzer prompt', (marker) => {
    expect(framePrompt('auto')).toContain(marker);
  });

  it.each(retrievalMarkers)('keeps "%s" in the gemini prompt', (marker) => {
    expect(buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'auto', tagLanguage: 'auto' })).toContain(marker);
  });

  it('keeps the output contract the parser expects', () => {
    expect(framePrompt('auto')).toContain(
      'DESCRIPTION: <text>\nFILENAME: <kebab-case-name>\nTAGS: <tag-one>, <tag-two>, <tag-three>',
    );
  });

  it('shares one language directive between both prompts', () => {
    const directive = languageInstruction({ outputLanguage: 'pl', tagLanguage: 'auto' });

    expect(directive).toBe('\n\nWrite the DESCRIPTION and the FILENAME in Polish.');
    expect(framePrompt('pl', 'auto')).toContain(directive);
    expect(buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'pl', tagLanguage: 'auto' })).toContain(directive);
    expect(languageInstruction({ outputLanguage: 'auto', tagLanguage: 'auto' })).toBe('');
  });

  it.each([
    { outputLanguage: 'auto', tagLanguage: 'auto' },
    { outputLanguage: 'auto', tagLanguage: 'pl' },
    { outputLanguage: 'pl', tagLanguage: 'pl' },
    { outputLanguage: 'pl', tagLanguage: 'en' },
  ])('builds the exact language clauses for output=$outputLanguage tag=$tagLanguage', ({ outputLanguage, tagLanguage }) => {
    const directive = languageInstruction({ outputLanguage, tagLanguage });

    if (outputLanguage === 'auto' && tagLanguage === 'auto') {
      expect(directive).toBe('');
      return;
    }
    if (outputLanguage !== 'auto') {
      expect(directive).toContain(`Write the DESCRIPTION and the FILENAME in ${outputLanguage === 'pl' ? 'Polish' : 'English'}.`);
    }
    if (tagLanguage !== 'auto') {
      const tagLanguageName = tagLanguage === 'pl' ? 'Polish' : 'English';
      expect(directive).toContain(`Write every TAG in ${tagLanguageName}`);
      expect(directive).toContain('transliterate diacritics');
      expect(directive).toContain('ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź→z, ż→z');
    }
    expect(framePrompt(outputLanguage, tagLanguage)).toContain(directive);
    expect(buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage, tagLanguage })).toContain(directive);
  });

  it('leaves the gemini transcript section untouched', () => {
    const prompt = buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'auto', tagLanguage: 'auto' });

    expect(prompt).toContain(
      'TRANSCRIPT: verbatim speech and on-screen text with timestamps, one segment per line formatted [MM:SS] text. If there is no speech at all, write exactly: NONE',
    );
  });
});
