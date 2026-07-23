import { describe, expect, it } from 'vitest';

import {
  filterHallucinatedSegments,
  filterTranscript,
  isHallucinatedSegment,
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

describe('isHallucinatedSegment', () => {
  it('matches the blocklist case- and punctuation-insensitively', () => {
    for (const text of ['Thank you.', 'thank you', 'THANK YOU!', '  Thank  you  ']) {
      expect(isHallucinatedSegment(segment({ text }), { isOnlyContent: true })).toBe(true);
    }
  });

  it('drops a short blocklisted phrase that is the only content even without metadata', () => {
    expect(isHallucinatedSegment(segment({ text: 'Thanks for watching' }), { isOnlyContent: true })).toBe(true);
  });

  it('keeps a blocklisted phrase with speech evidence when it is not the only content', () => {
    const evidenced = segment({ text: 'Thank you.', noSpeechProb: 0.05, avgLogprob: -0.2 });
    expect(isHallucinatedSegment(evidenced, { isOnlyContent: false })).toBe(false);
  });

  it('drops a blocklisted phrase when metadata indicates low confidence', () => {
    const lowByNoSpeech = segment({ text: 'Thank you.', noSpeechProb: 0.8, avgLogprob: -0.2 });
    const lowByLogprob = segment({ text: 'Thank you.', noSpeechProb: 0.1, avgLogprob: -1.5 });
    expect(isHallucinatedSegment(lowByNoSpeech, { isOnlyContent: false })).toBe(true);
    expect(isHallucinatedSegment(lowByLogprob, { isOnlyContent: false })).toBe(true);
  });

  it('never touches legitimate short phrases that are not on the blocklist', () => {
    expect(isHallucinatedSegment(segment({ text: 'Hello there' }), { isOnlyContent: true })).toBe(false);
    expect(isHallucinatedSegment(segment({ text: 'Cześć wszystkim' }), { isOnlyContent: true })).toBe(false);
  });

  it('never touches long blocklisted-looking text beyond four words', () => {
    expect(isHallucinatedSegment(segment({ text: 'thank you for watching this whole thing' }), { isOnlyContent: true })).toBe(false);
  });

  it('filters Polish hallucinations', () => {
    expect(isHallucinatedSegment(segment({ text: 'Dziękuję.' }), { isOnlyContent: true })).toBe(true);
    expect(isHallucinatedSegment(segment({ text: 'Dzięki za oglądanie' }), { isOnlyContent: true })).toBe(true);
  });
});

describe('filterHallucinatedSegments', () => {
  it('removes a low-confidence hallucination while keeping real neighbours', () => {
    const segments = [
      segment({ text: 'We drove to the coast at dawn.', noSpeechProb: 0.02, avgLogprob: -0.3 }),
      segment({ text: 'Thank you.', noSpeechProb: 0.9, avgLogprob: -1.8 }),
      segment({ text: 'It was a beautiful morning.', noSpeechProb: 0.03, avgLogprob: -0.25 }),
    ];
    const kept = filterHallucinatedSegments(segments);
    expect(kept.map((entry) => entry.text)).toEqual([
      'We drove to the coast at dawn.',
      'It was a beautiful morning.',
    ]);
  });

  it('keeps a real short blocklisted-adjacent segment when it has speech evidence', () => {
    const segments = [
      segment({ text: 'Thank you so much everyone.', noSpeechProb: 0.02, avgLogprob: -0.2 }),
      segment({ text: 'The trip was unforgettable.', noSpeechProb: 0.02, avgLogprob: -0.2 }),
    ];
    expect(filterHallucinatedSegments(segments)).toHaveLength(2);
  });
});

describe('filterTranscript', () => {
  it('empties a near-silent transcript whose only segment is a hallucination', () => {
    const result = filterTranscript('Thank you.', [segment({ text: 'Thank you.' })]);
    expect(result.text).toBe('');
    expect(result.segments).toEqual([]);
  });

  it('empties a near-silent transcript with no segment metadata (raw text only)', () => {
    expect(filterTranscript('Dziękuję.', null).text).toBe('');
  });

  it('leaves a legitimate transcript untouched', () => {
    const raw = 'We drove to the coast at dawn.';
    const result = filterTranscript(raw, [segment({ text: raw, noSpeechProb: 0.02, avgLogprob: -0.2 })]);
    expect(result.text).toBe(raw);
    expect(result.segments).toHaveLength(1);
  });

  it('rebuilds text from the surviving segments when a hallucination is dropped', () => {
    const segments = [
      segment({ text: 'We drove to the coast at dawn.', noSpeechProb: 0.02, avgLogprob: -0.3 }),
      segment({ text: 'Thank you.', noSpeechProb: 0.9, avgLogprob: -1.8 }),
    ];
    const result = filterTranscript('We drove to the coast at dawn.\nThank you.', segments);
    expect(result.text).toBe('We drove to the coast at dawn.');
    expect(result.segments.map((entry) => entry.text)).toEqual(['We drove to the coast at dawn.']);
  });
});

describe('parseRichSegments', () => {
  it('reads verbose_json segments with confidence metadata', () => {
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

  it('rejects malformed segments', () => {
    expect(richSegmentFromRaw({ start: 2, end: 1, text: 'x' })).toBeNull();
    expect(richSegmentFromRaw({ start: 0, end: 1, text: '' })).toBeNull();
    expect(parseRichSegments({ nothing: true })).toBeNull();
  });
});
