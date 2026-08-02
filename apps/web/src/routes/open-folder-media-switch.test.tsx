import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MenuEventHandler, MenuEventName, Unsubscribe } from '@core/contract/index.js';

import { bridge } from '../api.js';
import { en } from '../i18n/dictionary.js';
import { renderWithProviders } from '../test/render.js';
import { server } from '../test/server.js';
import { createAppTheme } from '../theme.js';
import { IndexRoute } from './index.js';

const theme = createAppTheme('light');
const renderRoute = () => renderWithProviders(<ThemeProvider theme={theme}><IndexRoute /></ThemeProvider>);

const NEW_FOLDER = '/videos/new-folder';

const stubBaseline = () => {
  server.use(
    http.get('/api/scan', () => HttpResponse.json({
      ok: true,
      data: {
        folder: NEW_FOLDER,
        databasePath: `${NEW_FOLDER}/.ai-video-cataloger/catalog.db`,
        videos: [],
        summary: { total: 0, tracked: 0, pending: 0, inProgress: 0, completed: 0, error: 0, notTracked: 0 },
      },
    })),
    http.get('/api/photos/status', () => HttpResponse.json({
      ok: true,
      data: {
        media: 'photo',
        root: '/pictures',
        counts: {
          photos: 0,
          paths: 0,
          exifRead: 0,
          exifFailed: 0,
          missing: 0,
          duplicates: 0,
          proxied: 0,
          proxyFailed: 0,
          analysed: 0,
          facesIndexed: 0,
        },
      },
    })),
    http.get('/api/photos/tree', () => HttpResponse.json({
      ok: true,
      data: { media: 'photo', roots: [] },
    })),
    http.get('/api/photos/list', () => HttpResponse.json({
      ok: true,
      data: { media: 'photo', root: '/pictures', total: 0, offset: 0, items: [] },
    })),
  );
};

const stubCheckOk = () => {
  server.use(http.get('/api/check', () => HttpResponse.json({
    ok: true,
    data: {
      hasNestedDatabases: false,
      nestedPaths: [],
      ownNestedPaths: [],
      basePath: NEW_FOLDER,
      scannedDirectories: 1,
    },
  })));
};

const stubCheckFails = () => {
  server.use(http.get('/api/check', () => HttpResponse.json(
    { ok: false, error: { code: 'folder_not_found', message: 'Folder no longer exists' } },
    { status: 404 },
  )));
};

const mockFolderBridge = (initialFolder: string | null) => {
  let currentFolder = initialFolder;
  const getCurrent = vi.spyOn(bridge.folder, 'getCurrent').mockImplementation(() => Promise.resolve(currentFolder));
  const getRecent = vi.spyOn(bridge.folder, 'getRecent')
    .mockImplementation(() => Promise.resolve(currentFolder === null ? [] : [currentFolder]));
  const setCurrent = vi.spyOn(bridge.folder, 'setCurrent').mockImplementation((folderPath: string) => {
    currentFolder = folderPath;
    return Promise.resolve();
  });
  return { getCurrent, getRecent, setCurrent };
};

const isOpenFolderHandler = (value: unknown): value is MenuEventHandler<'openFolder'> => typeof value === 'function';

const originalMenuOn = bridge.menu.on;

const captureOpenFolderMenuHandler = (): (() => void) => {
  let handler: MenuEventHandler<'openFolder'> | null = null;
  function fakeOn(name: 'openFolder', listener: MenuEventHandler<'openFolder'>): Unsubscribe;
  function fakeOn(name: 'openRecentFolder', listener: MenuEventHandler<'openRecentFolder'>): Unsubscribe;
  function fakeOn(name: 'clearRecentFolders', listener: MenuEventHandler<'clearRecentFolders'>): Unsubscribe;
  function fakeOn(name: 'toggleTerminal', listener: MenuEventHandler<'toggleTerminal'>): Unsubscribe;
  function fakeOn(name: 'toggleSidebar', listener: MenuEventHandler<'toggleSidebar'>): Unsubscribe;
  function fakeOn(name: 'showSettings', listener: MenuEventHandler<'showSettings'>): Unsubscribe;
  function fakeOn(name: 'showPrerequisites', listener: MenuEventHandler<'showPrerequisites'>): Unsubscribe;
  function fakeOn(name: 'showModelManager', listener: MenuEventHandler<'showModelManager'>): Unsubscribe;
  function fakeOn(name: 'showSetupWizard', listener: MenuEventHandler<'showSetupWizard'>): Unsubscribe;
  function fakeOn(name: MenuEventName, listener: unknown): Unsubscribe {
    if (name === 'openFolder' && isOpenFolderHandler(listener)) handler = listener;
    return () => undefined;
  }
  bridge.menu.on = fakeOn;
  return () => {
    if (handler === null) throw new Error('openFolder menu handler was never registered');
    handler(undefined);
  };
};

describe('picking a folder switches the analysis view to the picked folder', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubBaseline();
  });

  afterEach(() => {
    bridge.menu.on = originalMenuOn;
  });

  it('switches analysisMedia from photos to videos after a successful folder pick', async () => {
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'photos');
    mockFolderBridge('/old-movies');
    vi.spyOn(bridge.folder, 'showPicker').mockResolvedValue(NEW_FOLDER);
    stubCheckOk();

    renderRoute();

    await screen.findByTestId('photos-sidebar-empty');

    fireEvent.click(screen.getByRole('button', { name: en.folderBar.openFolder }));

    await waitFor(() => expect(screen.getByText(NEW_FOLDER)).toBeDefined());
    expect(screen.queryByTestId('photos-sidebar-empty')).toBeNull();
  });

  it('switches mode from library to analysis and analysisMedia to videos after a successful folder pick', async () => {
    window.localStorage.setItem('avc.mode', 'library');
    mockFolderBridge(null);
    vi.spyOn(bridge.folder, 'showPicker').mockResolvedValue(NEW_FOLDER);
    stubCheckOk();
    const triggerOpenFolder = captureOpenFolderMenuHandler();

    renderRoute();
    triggerOpenFolder();

    await waitFor(() => expect(screen.getByText(NEW_FOLDER)).toBeDefined());
    expect(window.localStorage.getItem('avc.mode')).toBe('analysis');
    expect(window.localStorage.getItem('avc.analysisMedia')).toBe('videos');
  });

  it('does not change mode or media when the folder picker is cancelled', async () => {
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'photos');
    mockFolderBridge('/old-movies');
    vi.spyOn(bridge.folder, 'showPicker').mockResolvedValue(null);
    stubCheckOk();

    renderRoute();

    await screen.findByTestId('photos-sidebar-empty');

    fireEvent.click(screen.getByRole('button', { name: en.folderBar.openFolder }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('photos-sidebar-empty')).not.toBeNull();
    expect(window.localStorage.getItem('avc.analysisMedia')).toBe('photos');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces the folder error and leaves mode/media untouched when check fails', async () => {
    window.localStorage.setItem('avc.mode', 'analysis');
    window.localStorage.setItem('avc.analysisMedia', 'photos');
    mockFolderBridge('/old-movies');
    vi.spyOn(bridge.folder, 'showPicker').mockResolvedValue(NEW_FOLDER);
    stubCheckFails();

    renderRoute();

    await screen.findByTestId('photos-sidebar-empty');

    fireEvent.click(screen.getByRole('button', { name: en.folderBar.openFolder }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Folder no longer exists'));
    expect(screen.queryByTestId('photos-sidebar-empty')).not.toBeNull();
    expect(window.localStorage.getItem('avc.analysisMedia')).toBe('photos');
  });
});
