import { describe, expect, it } from 'vitest';

import { buildGeminiPrompt } from '@adapters/gemini/index.js';

import { buildAnalyzerPrompt } from './index.js';
import { ANALYSIS_PROMPT_VERSION, outputLanguageInstruction } from './prompt.js';

const retrievalMarkers = [
  'Write for retrieval',
  'signs, placards, banners, shop and street names, vehicle registrations, printed or on-screen dates, screens, labels, numbers',
  'Never invent names or facts',
  'never invent utterances, languages, or lyrics',
  'setting and location claims only when visually supported',
  'never reframe the visible setting as a different place',
  'uncertain audio generically as music or ambience, without language or genre claims unless unambiguous',
  'the distinctive text or names you verified from the frames or the audio',
  'up to eight when the content earns them',
  'Never use filler words such as video, clip, footage, recording, scene or movie',
  'museum-exhibit',
  'tags that work as search handles',
  'notable text or proper nouns that pass the shared entity evidence rule',
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
    expect(ANALYSIS_PROMPT_VERSION).toBe(2);
  });

  it.each([
    ['frame-analyzer', framePrompt('auto')],
    ['gemini', buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'auto' })],
  ])('applies one entity evidence rule across every output field in the %s prompt', (_name, prompt) => {
    expect(prompt).toContain('Apply the same entity evidence rule to every claim in the DESCRIPTION, FILENAME, and TAGS');
    expect(prompt).toContain('replace it with a generic descriptor such as "boat exhibit placard" everywhere');
    expect(prompt).toContain('must never survive in the description or tags while being suppressed from the filename');
  });

  it.each([
    ['frame-analyzer', framePrompt('auto')],
    ['gemini', buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'auto' })],
  ])('requires attribute-based filename and tag fallbacks in the %s prompt', (_name, prompt) => {
    expect(prompt).toContain('build the filename from verifiable attributes of the clip');
    expect(prompt).toContain('square-sail-boat-17-knots or wooden-boat-cabin-green-wheel');
    expect(prompt).toContain('Never fall back to meaningless names such as video or video-2');
    expect(prompt).toContain('Tags must always carry the verifiable attributes of the clip');
    expect(prompt).toContain('An empty TAGS value or empty tag array is forbidden');
  });

  it.each([
    ['frame-analyzer', framePrompt('auto')],
    ['gemini', buildGeminiPrompt({ videoName: 'clip.mp4', outputLanguage: 'auto' })],
  ])('prefers exact legible or audible strings in the %s prompt', (_name, prompt) => {
    expect(prompt).toContain('Prefer exact on-screen or spoken strings when they are legibly readable on screen or clearly and audibly spoken');
    expect(prompt).toContain('preserving distinctive specifics such as "jektemodell"');
    expect(prompt).toContain('Prefer exact legible or audible strings when they pass the test');
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
