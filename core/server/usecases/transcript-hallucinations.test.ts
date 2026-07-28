import { describe, expect, it } from 'vitest';

import {
  filterTranscript,
  parseRichSegments,
  richSegmentFromRaw,
  type HallucinationSegment,
} from './transcript-hallucinations.js';

const segment = (overrides: Partial<HallucinationSegment>): HallucinationSegment => ({
  start: 0,
  end: 2,
  text: 'placeholder',
  noSpeechProb: null,
  avgLogprob: null,
  ...overrides,
});

describe('filterTranscript', () => {
  it('collapses five consecutive normalized copies to the first occurrence', () => {
    const repeated = [
      'The rooms are in separate rooms.',
      'the rooms are in separate rooms!',
      'THE ROOMS ARE IN SEPARATE ROOMS.',
      'The rooms are in separate rooms.',
      'The rooms are in separate rooms.',
    ].join(' ');

    expect(filterTranscript(repeated, null)).toEqual({
      text: 'The rooms are in separate rooms.',
      segments: [],
      filteredSegments: 4,
    });
  });

  it('keeps a double occurrence because the repetition threshold is three', () => {
    const transcript = 'Wait for me. Wait for me.';
    expect(filterTranscript(transcript, null).text).toBe(transcript);
  });

  it.each([
    'Dziękuję.',
    'Dziekuje za ogladanie!',
    'Thank you.',
    'Pain.',
  ])('strips a reviewed closer when it is the entire transcript: %s', (transcript) => {
    expect(filterTranscript(transcript, null)).toEqual({
      text: '',
      segments: [],
      filteredSegments: 1,
    });
  });

  it('strips the pilot interjection only from the transcript tail', () => {
    const transcript = 'Wracamy już do domu. Mamo, mamo, predko!';
    expect(filterTranscript(transcript, null).text).toBe('Wracamy już do domu.');
  });

  it('strips consecutive reviewed hallucinations after the last real speech', () => {
    const transcript = 'The train arrives at noon. Thank you. See you next time!';
    expect(filterTranscript(transcript, null)).toMatchObject({
      text: 'The train arrives at noon.',
      filteredSegments: 2,
    });
  });

  it('keeps reviewed phrases in the middle of real speech', () => {
    const transcript = 'Thank you. We should leave before noon. Do zobaczenia is Polish for see you.';
    expect(filterTranscript(transcript, null).text).toBe(transcript);
  });

  it('keeps garbled music-only fragments when there is no reliable evidence', () => {
    const transcript = 'Shaya molen treska.';
    expect(filterTranscript(transcript, null).text).toBe(transcript);
  });

  it('drops a segment marked as probably no-speech while keeping real neighbours', () => {
    const segments = [
      segment({ start: 0, end: 3, text: 'We drove to the coast.', noSpeechProb: 0.02, avgLogprob: -0.3 }),
      segment({ start: 3, end: 5, text: 'Music garble.', noSpeechProb: 0.91, avgLogprob: -1.8 }),
      segment({ start: 5, end: 8, text: 'It was a bright morning.', noSpeechProb: 0.03, avgLogprob: -0.25 }),
    ];

    expect(filterTranscript('We drove to the coast. Music garble. It was a bright morning.', segments)).toEqual({
      text: 'We drove to the coast.\nIt was a bright morning.',
      segments: [segments[0], segments[2]],
      filteredSegments: 1,
    });
  });

  it('keeps a high no-speech score when log probability supports real speech', () => {
    const real = segment({ text: 'Thank you for helping me today.', noSpeechProb: 0.8, avgLogprob: -0.2 });
    expect(filterTranscript(real.text, [real])).toEqual({ text: real.text, segments: [real], filteredSegments: 0 });
  });

  it('collapses repetitions that span metadata segments and preserves the first timing', () => {
    const segments = Array.from({ length: 5 }, (_, index) => segment({
      start: index * 2,
      end: index * 2 + 2,
      text: 'The same sentence repeats.',
    }));
    const result = filterTranscript(segments.map((entry) => entry.text).join('\n'), segments);

    expect(result.text).toBe('The same sentence repeats.');
    expect(result.segments).toEqual([segments[0]]);
    expect(result.filteredSegments).toBe(4);
  });
});

describe('parseRichSegments', () => {
  it('reads verbose JSON segments with confidence metadata', () => {
    const decoded = {
      text: 'Thank you.',
      segments: [{ start: 0, end: 2, text: 'Thank you.', no_speech_prob: 0.85, avg_logprob: -1.4 }],
    };
    expect(parseRichSegments(decoded)).toEqual([
      { start: 0, end: 2, text: 'Thank you.', noSpeechProb: 0.85, avgLogprob: -1.4 },
    ]);
  });

  it('reads whisper.cpp offsets in milliseconds', () => {
    const parsed = richSegmentFromRaw({ offsets: { from: 1000, to: 3500 }, text: ' Hello ' });
    expect(parsed).toEqual({ start: 1, end: 3.5, text: 'Hello', noSpeechProb: null, avgLogprob: null });
  });

  it('rejects malformed boundary data', () => {
    expect(richSegmentFromRaw({ start: 2, end: 1, text: 'x' })).toBeNull();
    expect(richSegmentFromRaw({ start: 0, end: 1, text: '' })).toBeNull();
    expect(parseRichSegments({ nothing: true })).toBeNull();
  });
});
