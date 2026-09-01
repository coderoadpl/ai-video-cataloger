import { describe, expect, it } from 'vitest';

import type { LibraryPhotoItem, LibraryVideoItem } from './day-groups.js';
import { videoViewerStage, viewerTitle } from './viewer-media.js';

const video = (overrides: Partial<LibraryVideoItem> = {}): LibraryVideoItem => ({
  media: 'video',
  fingerprint: 'fp-v1',
  variantCount: 1,
  fileName: 'clip.mp4',
  finalName: null,
  description: null,
  snippet: '',
  thumbnailPath: null,
  gridThumbnailPath: null,
  tags: [],
  folder: {
    folderId: '11111111-1111-4111-8111-111111111111',
    currentPath: '/videos',
    displayName: 'videos',
    online: true,
    offlineReason: null,
  },
  gps: null,
  missing: false,
  capturedAt: null,
  place: null,
  width: null,
  height: null,
  ...overrides,
});

const photo = (overrides: Partial<LibraryPhotoItem> = {}): LibraryPhotoItem => ({
  media: 'photo',
  fingerprint: 'ph_0000000000000001',
  fileName: 'beach.jpg',
  currentPath: '/photos/beach.jpg',
  ext: 'jpg',
  capturedAt: null,
  description: null,
  snippet: '',
  tags: [],
  variantCount: 0,
  missingAt: null,
  thumbPath: null,
  gridThumbPath: null,
  proxyPath: null,
  ...overrides,
});

describe('viewerTitle', () => {
  it('prefers the final name of a video over its file name', () => {
    expect(viewerTitle(video({ finalName: 'Renamed.mp4' }))).toBe('Renamed.mp4');
    expect(viewerTitle(video({ finalName: null }))).toBe('clip.mp4');
  });

  it('uses the file name of a photo', () => {
    expect(viewerTitle(photo())).toBe('beach.jpg');
  });
});

describe('videoViewerStage', () => {
  it('plays an online, present video from its folder path with the grid thumbnail as poster', () => {
    expect(videoViewerStage(video({ gridThumbnailPath: '/thumbs/clip.grid.jpg', thumbnailPath: '/thumbs/clip.jpg' }))).toEqual({
      kind: 'player',
      path: '/videos/clip.mp4',
      posterPath: '/thumbs/clip.grid.jpg',
    });
  });

  it('falls back to the small thumbnail, then to no poster at all', () => {
    expect(videoViewerStage(video({ thumbnailPath: '/thumbs/clip.jpg' }))).toMatchObject({ posterPath: '/thumbs/clip.jpg' });
    expect(videoViewerStage(video())).toMatchObject({ posterPath: null });
  });

  it('reports the folder offline reason instead of a player when the folder is offline', () => {
    expect(videoViewerStage(video({
      folder: {
        folderId: '11111111-1111-4111-8111-111111111111',
        currentPath: '/videos',
        displayName: 'videos',
        online: false,
        offlineReason: 'file-missing',
      },
    }))).toEqual({ kind: 'unavailable', reason: 'file-missing' });
  });

  it('treats an offline folder with no stated reason as a disconnected drive', () => {
    expect(videoViewerStage(video({
      folder: {
        folderId: '11111111-1111-4111-8111-111111111111',
        currentPath: '/videos',
        displayName: 'videos',
        online: false,
        offlineReason: null,
      },
    }))).toEqual({ kind: 'unavailable', reason: 'drive-disconnected' });
  });

  it('reports a missing file in an online folder', () => {
    expect(videoViewerStage(video({ missing: true }))).toEqual({ kind: 'unavailable', reason: 'file-missing' });
  });
});
