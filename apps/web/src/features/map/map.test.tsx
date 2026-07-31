import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { MapView } from './MapView.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const onlineFolder = {
  folderId: '11111111-1111-4111-8111-111111111111',
  currentPath: '/videos',
  displayName: 'videos',
  online: true,
};

const offlineFolder = {
  ...onlineFolder,
  folderId: '22222222-2222-4222-8222-222222222222',
  currentPath: '/offline-drive',
  displayName: 'offline-drive',
  online: false,
};

interface LocationOverrides {
  fingerprint?: string;
  media?: 'video' | 'photo';
  fileName?: string;
  finalName?: string | null;
  thumbPath?: string | null;
  lat?: number;
  lon?: number;
  missing?: boolean;
  folder?: typeof onlineFolder;
  source?: 'camera' | 'timeline' | 'manual' | null;
  accuracyM?: number | null;
  intervalKind?: 'visit' | 'activity' | 'path' | null;
  place?: { name: string; region: string | null; country: string | null; countryCode: string | null; distanceM: number; dataset: string } | null;
}

const location = (overrides: LocationOverrides = {}) => ({
  fingerprint: 'fp-1',
  media: 'video' as const,
  fileName: 'clip.mp4',
  finalName: null,
  thumbPath: null,
  lat: 50,
  lon: 10,
  missing: false,
  folder: onlineFolder,
  source: 'camera' as const,
  accuracyM: null,
  intervalKind: null,
  place: null,
  ...overrides,
});

const respondWith = (data: unknown) =>
  server.use(http.get('/api/catalog/locations', () => HttpResponse.json({ ok: true, data })));

describe('MapView', () => {
  it('shows the empty state and an honest coverage caption when nothing carries GPS', async () => {
    respondWith({ totalFiles: 3752, locatedFiles: 0, locations: [] });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-empty-state')).toBeDefined());
    expect(screen.getByTestId('map-coverage').textContent).toBe('0 of 3752 catalogued files have location');
    expect(screen.queryByTestId('map-pin')).toBeNull();
  });

  it('shows a coverage caption and pins for a partial catalog', async () => {
    respondWith({
      totalFiles: 3752,
      locatedFiles: 2,
      locations: [
        location({ fingerprint: 'fp-1', lat: 10, lon: 10 }),
        location({ fingerprint: 'fp-2', lat: -30, lon: -60 }),
      ],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-coverage')).toBeDefined());
    expect(screen.getByTestId('map-coverage').textContent).toBe('2 of 3752 catalogued files have location');
    expect(screen.getAllByTestId('map-pin')).toHaveLength(2);
    expect(screen.queryByTestId('map-cluster')).toBeNull();
  });

  it('clusters nearby pins and separates them on click', async () => {
    respondWith({
      totalFiles: 5,
      locatedFiles: 5,
      locations: [
        location({ fingerprint: 'a', lat: 50, lon: 10 }),
        location({ fingerprint: 'b', lat: 50, lon: 10.02 }),
        location({ fingerprint: 'c', lat: 50.02, lon: 10 }),
        location({ fingerprint: 'd', lat: 50.02, lon: 10.02 }),
        location({ fingerprint: 'far', lat: 50.3, lon: 10.5 }),
      ],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-cluster')).toBeDefined());
    expect(screen.getByTestId('map-cluster').getAttribute('aria-label')).toBe('4 videos in this area');
    expect(screen.getAllByTestId('map-pin')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('map-cluster'));

    await waitFor(() => expect(screen.getAllByTestId('map-pin')).toHaveLength(5));
    expect(screen.queryByTestId('map-cluster')).toBeNull();
  });

  it('opens a pin popover and routes the open-preview click with the fileName-bearing location, not finalName', async () => {
    const onOpenPreview = vi.fn();
    respondWith({
      totalFiles: 1,
      locatedFiles: 1,
      locations: [location({ fingerprint: 'fp-1', fileName: 'clip.mp4', finalName: 'renamed.mp4' })],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={onOpenPreview} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-pin')).toBeDefined());
    fireEvent.click(screen.getByTestId('map-pin'));

    expect(screen.getByTestId('map-pin-coordinates').textContent).toBe('50.0000° N, 10.0000° E');
    fireEvent.click(screen.getByTestId('map-open-video'));
    expect(onOpenPreview).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'fp-1', fileName: 'clip.mp4' }));
  });

  it('disables opening a video whose folder is offline and shows the drive-not-connected chip', async () => {
    respondWith({
      totalFiles: 1,
      locatedFiles: 1,
      locations: [location({ fingerprint: 'fp-1', folder: offlineFolder })],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-pin')).toBeDefined());
    fireEvent.click(screen.getByTestId('map-pin'));

    expect(screen.getByText('drive not connected')).toBeDefined();
    expect(screen.getByTestId('map-open-video')).toHaveProperty('disabled', true);
  });

  it('shows an error alert without crashing when the request fails', async () => {
    server.use(http.get('/api/catalog/locations', () => HttpResponse.json(
      { ok: false, error: { code: 'not_found', message: 'boom' } },
      { status: 404 },
    )));

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-error')).toBeDefined());
  });

  it('focuses a pin and consumes the focus request exactly once', async () => {
    const onFocusConsumed = vi.fn();
    respondWith({
      totalFiles: 2,
      locatedFiles: 2,
      locations: [
        location({ fingerprint: 'fp-1', lat: 10, lon: 10 }),
        location({ fingerprint: 'fp-2', lat: -30, lon: -60 }),
      ],
    });

    const rendered = renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={onFocusConsumed} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getAllByTestId('map-pin')).toHaveLength(2));

    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <ThemeProvider theme={theme}>
          <MapView active focusFingerprint="fp-2" onFocusConsumed={onFocusConsumed} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('map-pin-coordinates')).toBeDefined());
    expect(onFocusConsumed).toHaveBeenCalledTimes(1);
  });

  it('draws no basemap ring across the whole world at the antimeridian', async () => {
    respondWith({
      totalFiles: 2,
      locatedFiles: 2,
      locations: [
        location({ fingerprint: 'fp-1', lat: 10, lon: 10 }),
        location({ fingerprint: 'fp-2', lat: -30, lon: -60 }),
      ],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-canvas')).toBeDefined());
    const polygons = [...document.querySelectorAll('polygon')];
    expect(polygons.length).toBeGreaterThan(0);
    const widestStep = Math.max(...polygons.map((polygon) => {
      const xs = (polygon.getAttribute('points') ?? '').split(' ').map((pair) => Number(pair.split(',')[0]));
      return xs.slice(1).reduce((widest, x, index) => Math.max(widest, Math.abs(x - (xs[index] ?? 0))), 0);
    }));
    expect(widestStep).toBeLessThan(400);
  });

  it('does not start a map drag when the press lands on a pin', async () => {
    respondWith({
      totalFiles: 1,
      locatedFiles: 1,
      locations: [location({ fingerprint: 'fp-1' })],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-pin')).toBeDefined());
    const capture = vi.fn();
    HTMLElement.prototype.setPointerCapture = capture;
    onTestFinished(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    });

    fireEvent.pointerDown(screen.getByTestId('map-pin'), { pointerId: 1 });
    expect(capture).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByTestId('map-canvas'), { pointerId: 2 });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state before data arrives', async () => {
    server.use(http.get('/api/catalog/locations', async () => {
      await delay(20);
      return HttpResponse.json({ ok: true, data: { totalFiles: 0, locatedFiles: 0, locations: [] } });
    }));

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    expect(screen.getByTestId('map-loading')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('map-empty-state')).toBeDefined());
  });

  it('draws a hollow pin with an accuracy halo for a timeline-sourced location, never for a camera one', async () => {
    respondWith({
      totalFiles: 2,
      locatedFiles: 2,
      locations: [
        location({ fingerprint: 'fp-camera', source: 'camera' }),
        location({ fingerprint: 'fp-timeline', lat: 20, lon: 20, source: 'timeline', accuracyM: 150, intervalKind: 'visit' }),
      ],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getAllByTestId('map-pin')).toHaveLength(2));
    const pins = screen.getAllByTestId('map-pin');
    const approximateFlags = pins.map((pin) => pin.getAttribute('data-approximate'));
    expect(approximateFlags).toContain('true');
    expect(approximateFlags).toContain('false');
    expect(screen.getByTestId('map-pin-accuracy-halo')).toBeDefined();
  });

  it('shows the source badge and place line in the pin popover for an approximate location', async () => {
    respondWith({
      totalFiles: 1,
      locatedFiles: 1,
      locations: [location({
        fingerprint: 'fp-1',
        source: 'timeline',
        accuracyM: 150,
        intervalKind: 'visit',
        place: { name: 'Fjordvik', region: null, country: 'Norway', countryCode: 'NO', distanceM: 30, dataset: 'test' },
      })],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-pin')).toBeDefined());
    fireEvent.click(screen.getByTestId('map-pin'));

    await waitFor(() => expect(screen.getByTestId('map-pin-source-badge')).toBeDefined());
    expect(screen.getByTestId('map-pin-source-badge').textContent).toContain('±150 m');
    expect(screen.getByTestId('map-pin-place').textContent).toBe('Fjordvik · Norway');
  });

  it('shows a second coverage line for photos only when the catalog has any, and the media filter toggles pin sets', async () => {
    respondWith({
      totalFiles: 1,
      locatedFiles: 1,
      totalPhotos: 2,
      locatedPhotos: 1,
      locations: [
        location({ fingerprint: 'fp-video', media: 'video', lat: 10, lon: 10 }),
        location({ fingerprint: 'fp-photo', media: 'photo', fileName: 'a.jpg', lat: -30, lon: -60 }),
      ],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getAllByTestId('map-pin')).toHaveLength(2));
    expect(screen.getByTestId('map-coverage-photos').textContent).toBe('1 of 2 catalogued photos have location');

    fireEvent.click(screen.getByTestId('map-media-filter-photo'));
    await waitFor(() => expect(screen.getAllByTestId('map-pin')).toHaveLength(1));
    expect(screen.getAllByTestId('map-pin')[0]?.getAttribute('data-media')).toBe('photo');

    fireEvent.click(screen.getByTestId('map-media-filter-video'));
    await waitFor(() => expect(screen.getAllByTestId('map-pin')).toHaveLength(1));
    expect(screen.getAllByTestId('map-pin')[0]?.getAttribute('data-media')).toBe('video');

    fireEvent.click(screen.getByTestId('map-media-filter-all'));
    await waitFor(() => expect(screen.getAllByTestId('map-pin')).toHaveLength(2));
  });

  it('does not show the photos coverage line or filter chips when the catalog has no photos', async () => {
    respondWith({
      totalFiles: 1,
      locatedFiles: 1,
      totalPhotos: 0,
      locatedPhotos: 0,
      locations: [location({ fingerprint: 'fp-video' })],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-pin')).toBeDefined());
    expect(screen.queryByTestId('map-coverage-photos')).toBeNull();
  });

  it('shows a photo pin popover with an open-photo action and no open-video button, and routes the click through onOpenPhoto', async () => {
    const onOpenPhoto = vi.fn();
    respondWith({
      totalFiles: 0,
      locatedFiles: 0,
      totalPhotos: 1,
      locatedPhotos: 1,
      locations: [location({ fingerprint: 'fp-photo', media: 'photo', fileName: 'a.jpg' })],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenPreview={vi.fn()} onOpenPhoto={onOpenPhoto} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-pin')).toBeDefined());
    fireEvent.click(screen.getByTestId('map-pin'));

    await waitFor(() => expect(screen.getByTestId('map-open-photo')).toBeDefined());
    expect(screen.queryByTestId('map-open-video')).toBeNull();
    fireEvent.click(screen.getByTestId('map-open-photo'));
    expect(onOpenPhoto).toHaveBeenCalledWith('fp-photo');
  });
});
