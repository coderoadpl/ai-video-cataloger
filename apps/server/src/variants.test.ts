import { describe, expect, it } from 'vitest';

import {
  buildConfigDescriptor,
  configId,
  type CatalogFile,
  type CatalogFolder,
  type CatalogVariant,
} from '@core/domain/index.js';

import { buildApp } from './app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

const folder: CatalogFolder = {
  folderId: '11111111-1111-4111-8111-111111111111',
  currentPath: '/work',
  displayName: 'work',
  firstSeenAt: '2026-08-01T00:00:00.000Z',
  lastSeenAt: '2026-08-02T00:00:00.000Z',
};

const fingerprint = 'fingerprint-706';
const descriptor = buildConfigDescriptor({ output_language: 'pl' }, 4);
const resolvedConfigId = configId(descriptor);

const file: CatalogFile = {
  fingerprint,
  folderId: folder.folderId,
  fileName: 'clip.mp4',
  size: 100,
  durationS: 10,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-08-02T00:00:00.000Z',
  analyzer: 'claude-code',
  model: null,
  missingAt: null,
};

const variant: CatalogVariant = {
  fingerprint,
  configId: resolvedConfigId,
  descriptor,
  finalName: 'named.mp4',
  description: 'Polish description',
  transcript: 'Transcript',
  language: 'pl',
  tags: ['example'],
  analyzer: 'claude-code',
  model: null,
  createdAt: '2026-08-02T00:00:00.000Z',
  usage: { estimatedCostUsd: 0.02 },
};

const seededApp = async () => {
  const deps = createInMemoryDeps({ workingDirectory: '/work', files: ['/work/clip.mp4'] });
  await deps.globalCatalog.upsertFolder(folder);
  await deps.globalCatalog.upsertFile(file);
  await deps.globalCatalog.upsertVariant(variant);
  await deps.globalCatalog.setSelectedVariant(fingerprint, resolvedConfigId);
  await deps.globalCatalog.setFolderDefaultVariant(folder.folderId, resolvedConfigId);
  return buildApp(deps);
};

describe('variant routes', () => {
  it('returns every comparison field through the GET contract', async () => {
    const app = await seededApp();

    const response = await app.request(`/api/variants?fingerprint=${fingerprint}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        fingerprint,
        videoPath: '/work/clip.mp4',
        folderPath: '/work',
        folderDefaultConfigId: resolvedConfigId,
        currentConfig: {
          configId: expect.stringMatching(/^cfg_/),
          descriptor: expect.objectContaining({ output_language: 'auto' }),
        },
        variants: [{
          configId: resolvedConfigId,
          descriptor: { output_language: 'pl', promptVersion: 4 },
          label: 'claude-code',
          selected: true,
          description: 'Polish description',
          transcript: 'Transcript',
          estimatedCostUsd: 0.02,
        }],
      },
    });
  });

  it('maps missing selection and deletion targets to variant_not_found 404 responses', async () => {
    const app = await seededApp();
    const missingConfigId = 'cfg_000000000000';

    for (const route of ['/api/variants/select', '/api/variants/delete']) {
      const response = await app.request(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fingerprint, configId: missingConfigId }),
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'variant_not_found' },
      });
    }
  });

  it('sets folder defaults and validates their bodies at the route boundary', async () => {
    const app = await seededApp();
    const accepted = await app.request('/api/variants/folder-default', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folderPath: '/work', configId: resolvedConfigId }),
    });

    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      ok: true,
      data: { defaultConfigId: resolvedConfigId, resolvedConfigId },
    });

    const response = await app.request('/api/variants/folder-default', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folderPath: '/work', configId: 'not-a-config' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
