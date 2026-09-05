import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { photosDetailOutputSchema } from '@core/contract/index.js';

import { configResponse } from '../../test/config-response.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { PhotoMetadataCard } from './PhotoMetadataCard.js';

const OWNER_PATH = '/photos/holiday/a.jpg';

const detailWith = (sightingPaths: readonly string[]) => photosDetailOutputSchema.parse({
  media: 'photo',
  photo: {
    fingerprint: 'ph_0000000000000001',
    folderId: 'path-aaaaaaaa',
    fileName: 'a.jpg',
    currentPath: OWNER_PATH,
    ext: 'jpg',
    size: 1024,
    width: 100,
    height: 100,
    orientation: 1,
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
    exifReadAt: null,
    proxyState: 'done',
    proxyWidth: 1280,
    proxyHeight: 960,
    thumbState: 'done',
    missingAt: null,
  },
  sightings: sightingPaths.map((currentPath) => ({
    currentPath,
    folderId: 'path-aaaaaaaa',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  })),
  ownerPath: OWNER_PATH,
  proxyPath: null,
  thumbPath: null,
  analysis: null,
});

const alsoAtPaths = () =>
  screen.queryAllByTestId('photo-metadata-row-also-at').map((row) => row.textContent ?? '');

const serveLanguage = (language: string) => {
  server.use(http.get('/api/config', () => HttpResponse.json(configResponse(language))));
};

describe('PhotoMetadataCard sightings', () => {
  it('hides the also-at block when the only sighting is the owner path', () => {
    serveLanguage('en');
    renderWithProviders(<PhotoMetadataCard detail={detailWith([OWNER_PATH])} />);

    expect(screen.getByTestId('photo-metadata-row-owner-path').textContent).toContain(OWNER_PATH);
    expect(screen.queryAllByTestId('photo-metadata-row-also-at')).toEqual([]);
  });

  it('lists only the sightings outside the owner path and counts them', () => {
    serveLanguage('en');
    renderWithProviders(
      <PhotoMetadataCard detail={detailWith([OWNER_PATH, '/photos/backup/a.jpg', '/photos/archive/a.jpg'])} />,
    );

    const rows = alsoAtPaths();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe('Also at: 2 paths/photos/backup/a.jpg');
    expect(rows[1]).toContain('/photos/archive/a.jpg');
    expect(rows.join('')).not.toContain('/photos/holiday/a.jpg');
  });

  it('uses the singular Polish path form when one sighting remains after dropping the owner', async () => {
    serveLanguage('pl');
    renderWithProviders(<PhotoMetadataCard detail={detailWith([OWNER_PATH, '/photos/backup/a.jpg'])} />);

    await waitFor(() => expect(alsoAtPaths()).toEqual(['Także w: 1 ścieżce/photos/backup/a.jpg']));
  });
});
