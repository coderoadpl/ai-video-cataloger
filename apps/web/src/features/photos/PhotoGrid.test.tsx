import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { photoListItemSchema } from '@core/contract/index.js';

import { configResponse } from '../../test/config-response.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import type { DaySection } from './core/index.js';
import { PhotoGrid } from './PhotoGrid.js';

type PhotoListItem = z.output<typeof photoListItemSchema>;

const theme = createAppTheme('light');

const photo = (fingerprint: string, capturedAt: string | null): PhotoListItem => ({
  fingerprint,
  fileName: `${fingerprint}.jpg`,
  currentPath: `/media/${fingerprint}.jpg`,
  ext: 'jpg',
  capturedAt,
  capturedAtSource: capturedAt === null ? null : 'exif_offset',
  width: 4000,
  height: 3000,
  proxyState: 'done',
  thumbState: 'done',
  missingAt: null,
  sightings: 1,
  thumbPath: null,
  gridThumbPath: null,
  proxyPath: null,
  analysed: false,
  exifReadAt: '2026-01-01T00:00:00.000Z',
});

const sections: DaySection[] = [
  { day: '2026-08-10', label: '2026-08-10', items: [photo('ph_1', '2026-08-10T17:46:06.740Z')] },
  { day: null, label: '', items: [photo('ph_2', null)] },
];

const renderGrid = (uiLanguage: string) => {
  server.use(http.get('/api/config', () => HttpResponse.json(configResponse(uiLanguage))));
  renderWithProviders(
    <ThemeProvider theme={theme}>
      <PhotoGrid sections={sections} selectedFingerprint={null} onSelect={vi.fn()} onOpenViewer={vi.fn()} />
    </ThemeProvider>,
  );
};

describe('PhotoGrid day-group headers', () => {
  it('renders the Polish day header, never the raw ISO group key', async () => {
    renderGrid('pl');

    expect(await screen.findByText('10 sierpnia 2026')).toBeDefined();
    expect(screen.queryByText('2026-08-10')).toBeNull();
  });

  it('renders the English day header, never the raw ISO group key', async () => {
    renderGrid('en');

    expect(await screen.findByText('10 August 2026')).toBeDefined();
    expect(screen.queryByText('2026-08-10')).toBeNull();
  });

  it('keeps the undated section on its dictionary label', async () => {
    renderGrid('pl');

    expect(await screen.findByText('Nieznana data')).toBeDefined();
  });
});
