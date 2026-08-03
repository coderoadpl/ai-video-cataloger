import { describe, expect, it } from 'vitest';

import { detailToListItem, type PhotoDetail } from './detail-to-item.js';

const detail = (overrides: Partial<PhotoDetail> = {}): PhotoDetail => ({
  media: 'photo',
  photo: {
    fingerprint: 'ph_0000000000000001',
    folderId: 'path-aaaaaaaa',
    fileName: 'a.jpg',
    currentPath: '/media/photos/a.jpg',
    ext: 'jpg',
    size: 1024,
    width: 100,
    height: 100,
    orientation: null,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    iso: null,
    fNumber: null,
    exposureTime: null,
    exifRating: null,
    capturedAt: '2026-01-01T00:00:00.000Z',
    capturedAtSource: 'file_mtime',
    discoveredAt: '2026-01-01T00:00:00.000Z',
    exifReadAt: '2026-01-01T00:00:00.000Z',
    proxyState: 'done',
    proxyWidth: 1280,
    proxyHeight: 720,
    thumbState: 'done',
    missingAt: null,
  },
  sightings: [{ currentPath: '/media/photos/a.jpg', folderId: 'path-aaaaaaaa', lastSeenAt: '2026-01-01T00:00:00.000Z' }],
  ownerPath: '/media/photos/a.jpg',
  proxyPath: '/artifacts/a-proxy.jpg',
  thumbPath: '/artifacts/a-thumb.jpg',
  gridThumbPath: '/artifacts/a-grid.jpg',
  analysis: null,
  ...overrides,
});

describe('detailToListItem', () => {
  it('maps every field a sidebar/viewer row needs from the detail response', () => {
    const item = detailToListItem(detail());
    expect(item).toEqual({
      fingerprint: 'ph_0000000000000001',
      fileName: 'a.jpg',
      currentPath: '/media/photos/a.jpg',
      ext: 'jpg',
      capturedAt: '2026-01-01T00:00:00.000Z',
      capturedAtSource: 'file_mtime',
      width: 100,
      height: 100,
      proxyState: 'done',
      thumbState: 'done',
      missingAt: null,
      sightings: 1,
      thumbPath: '/artifacts/a-thumb.jpg',
      gridThumbPath: '/artifacts/a-grid.jpg',
      proxyPath: '/artifacts/a-proxy.jpg',
      analysed: false,
      exifReadAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('counts sightings from the sightings array and reports analysed once an analysis exists', () => {
    const item = detailToListItem(detail({
      sightings: [
        { currentPath: '/a', folderId: 'f', lastSeenAt: '2026-01-01T00:00:00.000Z' },
        { currentPath: '/b', folderId: 'f', lastSeenAt: '2026-01-01T00:00:00.000Z' },
      ],
      analysis: {
        configId: 'cfg_aaaaaaaaaaaa',
        label: 'harness',
        description: 'd',
        scene: 's',
        quality: 'q',
        tags: [],
        batchSize: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        variantCount: 1,
        explicit: false,
      },
    }));
    expect(item.sightings).toBe(2);
    expect(item.analysed).toBe(true);
  });
});
