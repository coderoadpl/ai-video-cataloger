import { describe, expect, it } from 'vitest';

import { formatCapturedAt, formatCoordinates, formatDayLabel } from './format.js';

describe('formatCoordinates', () => {
  it('renders northern and eastern hemispheres', () => {
    expect(formatCoordinates(50.0614, 19.9366)).toBe('50.0614° N, 19.9366° E');
  });

  it('renders southern and western hemispheres', () => {
    expect(formatCoordinates(-33.8688, -151.2093)).toBe('33.8688° S, 151.2093° W');
  });

  it('rounds to 4 decimals', () => {
    expect(formatCoordinates(1.23456789, 2.98765432)).toBe('1.2346° N, 2.9877° E');
  });

  it('treats zero as northern and eastern', () => {
    expect(formatCoordinates(0, 0)).toBe('0.0000° N, 0.0000° E');
  });
});

describe('formatCapturedAt', () => {
  it('renders a human-readable date and time instead of a raw ISO string', () => {
    const result = formatCapturedAt('2026-06-19T10:03:37.000Z', 'en');
    expect(result).not.toBeNull();
    expect(result).not.toContain('T');
    expect(result).not.toContain('Z');
  });

  it('passes null through unchanged', () => {
    expect(formatCapturedAt(null, 'en')).toBeNull();
  });

  it('renders Polish month names for the pl UI locale instead of always formatting in English', () => {
    const result = formatCapturedAt('2026-08-10T17:46:06.744Z', 'pl');
    expect(result).not.toBeNull();
    expect(result).toContain('sie');
    expect(result).not.toMatch(/Aug/);
  });
});

describe('formatDayLabel', () => {
  it('renders a Polish section-header day label instead of the raw ISO group key', () => {
    expect(formatDayLabel('2026-08-10', 'pl')).toBe('10 sierpnia 2026');
  });

  it('renders an English section-header day label', () => {
    expect(formatDayLabel('2026-08-10', 'en')).toBe('10 August 2026');
  });

  it('constructs the date from local components, not `new Date(isoString)`, so it cannot shift a day across a UTC offset', () => {
    expect(formatDayLabel('2000-01-01', 'pl')).toBe('1 stycznia 2000');
  });

  it('passes malformed input through unchanged rather than throwing', () => {
    expect(formatDayLabel('not-a-day', 'en')).toBe('not-a-day');
  });
});
