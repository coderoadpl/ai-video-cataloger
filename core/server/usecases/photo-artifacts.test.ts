import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';

import { photoGridThumbPath, photoThumbPath } from './photo-artifacts.js';

describe('photo grid thumb path', () => {
  const fs = new InMemoryFileSystem('/root');

  it('is the .grid sibling of the small thumb path', () => {
    expect(photoGridThumbPath(fs, '/root/photo-artifacts', 'abc123')).toBe(
      path.join('/root/photo-artifacts', 'thumbs', 'abc123.grid.jpg'),
    );
    expect(photoThumbPath(fs, '/root/photo-artifacts', 'abc123')).toBe(
      path.join('/root/photo-artifacts', 'thumbs', 'abc123.jpg'),
    );
  });
});
