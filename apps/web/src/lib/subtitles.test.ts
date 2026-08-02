import { describe, expect, it } from 'vitest';

import { buildWebVtt, formatVttTime } from './subtitles.js';

describe('WebVTT subtitles', () => {
  it('formats cue timings and content', () => {
    expect(buildWebVtt([
      { start: 0, end: 1.25, text: 'Hello' },
      { start: 61.5, end: 62, text: 'World' },
    ])).toBe('WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.250\nHello\n\n2\n00:01:01.500 --> 00:01:02.000\nWorld\n');
  });

  it('drops invalid and empty segments', () => {
    expect(buildWebVtt([
      { start: 3, end: 2, text: 'bad' },
      { start: -1, end: 0.5, text: ' edge ' },
      { start: 1, end: 2, text: ' ' },
    ])).toBe('WEBVTT\n\n1\n00:00:00.000 --> 00:00:00.500\nedge\n');
  });

  it('escapes cue markup and collapses newlines', () => {
    expect(buildWebVtt([
      { start: 0, end: 1, text: 'rock & roll <b> 5 > 3\nnext' },
    ])).toBe('WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nrock &amp; roll &lt;b&gt; 5 &gt; 3 next\n');
  });

  it('formats hour and millisecond edges', () => {
    expect(formatVttTime(3661.007)).toBe('01:01:01.007');
    expect(formatVttTime(-2)).toBe('00:00:00.000');
  });
});
