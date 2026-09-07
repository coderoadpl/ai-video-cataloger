import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { en } from '../../i18n/dictionary.js';
import { configResponse } from '../../test/config-response.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { LibraryVideoDetails } from './LibraryVideoPane.js';
import type { LibraryVideoItem } from './core/index.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const item: LibraryVideoItem = {
  media: 'video',
  fingerprint: 'fp-1',
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
};

const stubPreview = (people: readonly Record<string, unknown>[]): void => {
  server.use(
    http.get('/api/library/preview', () => HttpResponse.json({
      ok: true,
      data: {
        fingerprint: 'fp-1',
        path: '/videos/clip.mp4',
        fileName: 'clip.mp4',
        size: 2048,
        sizeFormatted: '2.0 KB',
        durationS: 65,
        durationFormatted: '1:05',
        transcript: null,
        transcriptSegments: null,
        width: null,
        height: null,
        rotation: null,
        people,
      },
    })),
  );
};

describe('LibraryVideoDetails', () => {
  beforeEach(() => {
    server.use(http.get('/api/config', () => HttpResponse.json(configResponse('en'))));
  });

  it('UI-029 names an unnamed person after its fallback index, never after its raw identifier', async () => {
    stubPreview([{ personId: 'person-7f3a91', displayName: null, fallbackIndex: 3 }]);

    renderThemed(<LibraryVideoDetails item={item} />);

    await waitFor(() => {
      expect(screen.getByTestId('library-media-viewer-people').textContent)
        .toContain(en.people.personName(3));
    });
    expect(screen.queryByText('person-7f3a91')).toBeNull();
  });

  it('keeps a named person under their stored name', async () => {
    stubPreview([{ personId: 'person-7f3a91', displayName: 'Ada', fallbackIndex: 3 }]);

    renderThemed(<LibraryVideoDetails item={item} />);

    await waitFor(() => {
      expect(screen.getByTestId('library-media-viewer-people').textContent).toContain('Ada');
    });
  });
});
