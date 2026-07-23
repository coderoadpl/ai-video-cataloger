import { describe, expect, it } from 'vitest';

import { en, getDict, pl } from './dictionary.js';

const keyPaths = (value: unknown, prefix = ''): string[] => {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix === '' ? key : `${prefix}.${key}`));
};

const leafValues = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(leafValues);
};

describe('dictionary', () => {
  it('keeps identical key structure across en and pl', () => {
    expect(keyPaths(pl).sort()).toEqual(keyPaths(en).sort());
  });

  it('has no empty strings in either locale', () => {
    for (const dictionary of [en, pl]) {
      for (const value of leafValues(dictionary)) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves the polish dictionary only for the pl locale', () => {
    expect(getDict('pl')).toBe(pl);
    expect(getDict('en')).toBe(en);
  });
});
