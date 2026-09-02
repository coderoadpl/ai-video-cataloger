import { describe, expect, it } from 'vitest';

import { forbiddenRendererDependencyReason } from '../apps/web/vite.config.js';

describe('renderer dependency guard', () => {
  it.each([
    'googleapis',
    '@googleapis/drive',
    '@google-cloud/local-auth',
    'node:fs',
  ])('rejects %s from the renderer module graph', (source) => {
    expect(forbiddenRendererDependencyReason(source, '/renderer/importer.ts')).toMatch(/renderer bundle graph/i);
  });

  it('allows browser-safe dependencies', () => {
    expect(forbiddenRendererDependencyReason('@core/domain/index.js', '/renderer/importer.ts')).toBeNull();
  });
});
