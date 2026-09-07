import { describe, expect, it } from 'vitest';

import { en, pl } from './dictionary.js';
import { personLabel } from './person-label.js';

describe('personLabel', () => {
  it('prefers the stored display name', () => {
    expect(personLabel(en, { displayName: 'Ada', fallbackIndex: 4 })).toBe('Ada');
  });

  it('UI-029 names an unnamed person by its one-based fallback index, never its identifier', () => {
    expect(personLabel(en, { displayName: null, fallbackIndex: 4 })).toBe('Person 5');
    expect(personLabel(pl, { displayName: null, fallbackIndex: 0 })).toBe('Osoba 1');
  });
});
