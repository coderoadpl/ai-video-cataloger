import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';

import { artifactPaths, gridThumbnailArtifactPath, parseSummary, summaryDataSchema, thumbnailArtifactPath } from './shared.js';
import { folderArtifactRoot } from './artifact-root.js';

const summary = {
  schemaVersion: 1,
  description: 'A useful description',
  suggestedFilename: 'useful-description',
  fullAnalysis: 'DESCRIPTION: A useful description\nFILENAME: useful-description',
  analyzedAt: '2026-07-14T12:00:00.000Z',
} as const;

describe('shared summary data contract', () => {
  it('validates and parses the persisted summary shape through the same contract', () => {
    expect(summaryDataSchema.parse(summary)).toEqual({ ...summary, tags: [] });
    expect(parseSummary(JSON.stringify(summary))).toEqual({ ...summary, tags: [] });
  });

  it('rejects malformed persisted summaries', () => {
    const malformed = { ...summary, suggestedFilename: 42 };

    expect(summaryDataSchema.safeParse(malformed).success).toBe(false);
    expect(parseSummary(JSON.stringify(malformed))).toBeNull();
  });
});

describe('grid thumbnail artifact path', () => {
  const fs = new InMemoryFileSystem('/videos/folder');
  const root = folderArtifactRoot(fs, '/videos/folder');

  it('is the .grid sibling of the small thumbnail path', () => {
    expect(gridThumbnailArtifactPath(fs, root, '/videos/folder/clip.mp4')).toBe(
      path.join(root.catalogDirectory, 'thumbnails', 'clip.grid.jpg'),
    );
    expect(thumbnailArtifactPath(fs, root, '/videos/folder/clip.mp4')).toBe(
      path.join(root.catalogDirectory, 'thumbnails', 'clip.jpg'),
    );
  });

  it('is included alongside thumbnailPath in artifactPaths', () => {
    const paths = artifactPaths(fs, root, '/videos/folder/clip.mp4', null);
    expect(paths.gridThumbnailPath).toBe(path.join(root.catalogDirectory, 'thumbnails', 'clip.grid.jpg'));
  });
});
