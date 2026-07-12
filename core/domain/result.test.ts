import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, map, ok, unwrapOr, type Result } from './result.js';

describe('Result helpers', () => {
  it('constructs ok and err variants', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('narrows with isOk / isErr', () => {
    const good: Result<number, string> = ok(2);
    const bad: Result<number, string> = err('nope');
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
  });

  it('unwrapOr returns the value or the fallback', () => {
    const bad: Result<number, string> = err('x');
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(bad, 0)).toBe(0);
  });

  it('map transforms only the ok branch', () => {
    const good: Result<number, string> = ok(3);
    const bad: Result<number, string> = err('e');
    expect(map(good, (n: number) => n * 2)).toEqual({ ok: true, value: 6 });
    expect(map(bad, (n: number) => n * 2)).toBe(bad);
  });
});
