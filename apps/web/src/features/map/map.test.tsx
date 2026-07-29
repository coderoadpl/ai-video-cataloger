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
  fileName?: string;
  finalName?: string | null;
  lat?: number;
  lon?: number;
  missing?: boolean;
  folder?: typeof onlineFolder;
}

const location = (overrides: LocationOverrides = {}) => ({
  fingerprint: 'fp-1',
  fileName: 'clip.mp4',
  finalName: null,
  lat: 50,
  lon: 10,
  missing: false,
  folder: onlineFolder,
  ...overrides,
});

const respondWith = (data: unknown) =>
  server.use(http.get('/api/catalog/locations', () => HttpResponse.json({ ok: true, data })));

describe('MapView', () => {
  it('shows the empty state and an honest coverage caption when nothing carries GPS', async () => {
    respondWith({ totalFiles: 3752, locatedFiles: 0, locations: [] });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenLocation={vi.fn()} />,
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
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenLocation={vi.fn()} />,
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
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenLocation={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-cluster')).toBeDefined());
    expect(screen.getByTestId('map-cluster').getAttribute('aria-label')).toBe('4 videos in this area');
    expect(screen.getAllByTestId('map-pin')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('map-cluster'));

    await waitFor(() => expect(screen.getAllByTestId('map-pin')).toHaveLength(5));
    expect(screen.queryByTestId('map-cluster')).toBeNull();
  });

  it('opens a pin popover and routes the open-video click by fileName, not finalName', async () => {
    const onOpenLocation = vi.fn();
    respondWith({
      totalFiles: 1,
      locatedFiles: 1,
      locations: [location({ fingerprint: 'fp-1', fileName: 'clip.mp4', finalName: 'renamed.mp4' })],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenLocation={onOpenLocation} />,
    );

    await waitFor(() => expect(screen.getByTestId('map-pin')).toBeDefined());
    fireEvent.click(screen.getByTestId('map-pin'));

    expect(screen.getByTestId('map-pin-coordinates').textContent).toBe('50.0000° N, 10.0000° E');
    fireEvent.click(screen.getByTestId('map-open-video'));
    expect(onOpenLocation).toHaveBeenCalledWith('/videos', '/videos/clip.mp4');
  });

  it('disables opening a video whose folder is offline and shows the drive-not-connected chip', async () => {
    respondWith({
      totalFiles: 1,
      locatedFiles: 1,
      locations: [location({ fingerprint: 'fp-1', folder: offlineFolder })],
    });

    renderThemed(
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenLocation={vi.fn()} />,
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
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenLocation={vi.fn()} />,
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
      <MapView active focusFingerprint={null} onFocusConsumed={onFocusConsumed} onOpenLocation={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getAllByTestId('map-pin')).toHaveLength(2));

    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <ThemeProvider theme={theme}>
          <MapView active focusFingerprint="fp-2" onFocusConsumed={onFocusConsumed} onOpenLocation={vi.fn()} />
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
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenLocation={vi.fn()} />,
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
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenLocation={vi.fn()} />,
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
      <MapView active focusFingerprint={null} onFocusConsumed={vi.fn()} onOpenLocation={vi.fn()} />,
    );

    expect(screen.getByTestId('map-loading')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('map-empty-state')).toBeDefined());
  });
});
