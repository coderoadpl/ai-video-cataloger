import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

  it('applies Polish three-form plural rules to counted copy', () => {
    expect(pl.people.observationCount(1)).toBe('1 obserwacja');
    expect(pl.people.observationCount(3)).toBe('3 obserwacje');
    expect(pl.people.observationCount(5)).toBe('5 obserwacji');
    expect(pl.search.resultCount(1)).toBe('1 wynik');
    expect(pl.search.resultCount(3)).toBe('3 wyniki');
    expect(pl.search.resultCount(5)).toBe('5 wyników');
  });

  it('uses English singular/plural siblings for counted copy', () => {
    expect(en.search.resultCount(1)).toBe('1 result');
    expect(en.search.resultCount(2)).toBe('2 results');
    expect(en.people.observationCount(1)).toBe('1 observation');
    expect(en.people.observationCount(2)).toBe('2 observations');
  });

  it('resolves the polish dictionary only for the pl locale', () => {
    expect(getDict('pl')).toBe(pl);
    expect(getDict('en')).toBe(en);
  });

  it('keeps swept UI literals inside the dictionary', () => {
    const literals = ['Search catalog', 'Analyze All', 'Getting Started', 'Only this folder', 'Not detected', 'Open Folder', 'Not Tracked', 'Local (Whisper.cpp)', 'Skip Transcription', 'No output yet. Run an analysis to see job progress here.'];
    const standaloneSaved = /(?<![A-Za-z])Saved(?![A-Za-z])/;

    const srcRoot = join(import.meta.dirname, '..');
    const violations: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (fullPath.includes(`${join('src', 'i18n')}`)) continue;
        if (fullPath.includes(`${join('src', 'gallery')}`)) continue;
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const content = readFileSync(fullPath, 'utf8');
        for (const literal of literals) {
          if (content.includes(literal)) violations.push(`${fullPath}: ${literal}`);
        }
        if (standaloneSaved.test(content)) violations.push(`${fullPath}: Saved`);
      }
    };

    walk(srcRoot);

    expect(violations).toEqual([]);
  });
});
