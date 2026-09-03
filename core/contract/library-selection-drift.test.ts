import { describe, expect, it } from 'vitest';

import { librarySelectionFilterSchema } from '@core/domain/index.js';

import { collectionInputSchema } from './routes.js';

const setDefiningKeys = (keys: readonly string[]): string[] => {
  const excluded = new Set(['sort', 'limit', 'cursor']);
  return keys.filter((key) => !excluded.has(key)).sort();
};

describe('library selection schema drift', () => {
  it('matches the set-defining collection input fields', () => {
    expect(setDefiningKeys(Object.keys(librarySelectionFilterSchema.shape))).toEqual(
      setDefiningKeys(Object.keys(collectionInputSchema.shape)),
    );
  });
});
