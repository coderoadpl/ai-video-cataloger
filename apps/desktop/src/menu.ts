import path from 'node:path';

import { app, type BrowserWindow, dialog, Menu, type MenuItemConstructorOptions, shell } from 'electron';

import { CHANNELS } from './channels.js';
import { installCurrentRuntimeCommandLineTool } from './cli-install.js';

export const createApplicationMenu = (mainWindow: BrowserWindow | null, recentFolders: readonly string[]): void => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(mainWindow, recentFolders)));
};

export const updateRecentFoldersMenu = (mainWindow: BrowserWindow | null, recentFolders: readonly string[]): void => {
  createApplicationMenu(mainWindow, recentFolders);
};

const menuTemplate = (
  mainWindow: BrowserWindow | null,
  recentFolders: readonly string[],
): MenuItemConstructorOptions[] => {
  const isMac = process.platform === 'darwin';
  return [
    ...(isMac ? [appMenu(mainWindow)] : []),
    fileMenu(mainWindow, recentFolders, isMac),
    editMenu(isMac),
    viewMenu(mainWindow),
    windowMenu(isMac),
    helpMenu(mainWindow),
  ];
};

const sendToRenderer = (mainWindow: BrowserWindow | null, channel: string, ...args: readonly unknown[]): void => {
  if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
};

const appMenu = (mainWindow: BrowserWindow | null): MenuItemConstructorOptions => ({
  label: app.name,
  submenu: [
    { role: 'about' },
    { type: 'separator' },
    {
      label: 'Settings...',
      accelerator: 'Cmd+,',
      click: () => sendToRenderer(mainWindow, CHANNELS.menuShowSettings),
    },
    {
      label: 'Install Command Line Tool…',
      click: () => {
        void installCliTool(mainWindow);
      },
    },
    { type: 'separator' },
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' },
  ],
});

const installCliTool = async (mainWindow: BrowserWindow | null): Promise<void> => {
  const result = await installCurrentRuntimeCommandLineTool(app.isPackaged);
  const message = result.ok
    ? `Installed. Run ai-video-cataloger in your terminal.\n\n${result.path}`
    : result.reason;
  const options = {
    type: result.ok ? 'info' : 'error',
    message,
  } as const;
  if (mainWindow === null) {
    await dialog.showMessageBox(options);
    return;
  }
  await dialog.showMessageBox(mainWindow, options);
};

const fileMenu = (
  mainWindow: BrowserWindow | null,
  recentFolders: readonly string[],
  isMac: boolean,
): MenuItemConstructorOptions => {
  const recentItems = recentFolders.map((folder) => ({
    label: path.basename(folder) || folder,
    click: () => sendToRenderer(mainWindow, CHANNELS.menuOpenRecentFolder, folder),
  }));
  return {
    label: 'File',
    submenu: [
      {
        label: 'Open Folder...',
        accelerator: 'CmdOrCtrl+O',
        click: () => sendToRenderer(mainWindow, CHANNELS.menuOpenFolder),
      },
      {
        label: 'Recent Folders',
        enabled: recentItems.length > 0,
        submenu: [
          ...recentItems,
          ...(recentItems.length === 0 ? [] : [{ type: 'separator' as const }]),
          {
            label: 'Clear Recent',
            enabled: recentItems.length > 0,
            click: () => sendToRenderer(mainWindow, CHANNELS.menuClearRecentFolders),
          },
        ],
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };
};

const editMenu = (isMac: boolean): MenuItemConstructorOptions => ({
  label: 'Edit',
  submenu: [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    ...(isMac
      ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const },
          { type: 'separator' as const },
          {
            label: 'Speech',
            submenu: [
              { role: 'startSpeaking' as const },
              { role: 'stopSpeaking' as const },
            ],
          },
        ]
      : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const },
        ]),
  ],
});

const viewMenu = (mainWindow: BrowserWindow | null): MenuItemConstructorOptions => ({
  label: 'View',
  submenu: [
    {
      label: 'Toggle Terminal Log',
      accelerator: 'CmdOrCtrl+T',
      click: () => sendToRenderer(mainWindow, CHANNELS.menuToggleTerminal),
    },
    {
      label: 'Toggle Sidebar',
      accelerator: 'CmdOrCtrl+B',
      click: () => sendToRenderer(mainWindow, CHANNELS.menuToggleSidebar),
    },
    { type: 'separator' },
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ],
});

const windowMenu = (isMac: boolean): MenuItemConstructorOptions => ({
  label: 'Window',
  submenu: [
    { role: 'minimize' },
    { role: 'zoom' },
    ...(isMac
      ? [
          { type: 'separator' as const },
          { role: 'front' as const },
          { type: 'separator' as const },
          { role: 'window' as const },
        ]
      : [{ role: 'close' as const }]),
  ],
});

const helpMenu = (mainWindow: BrowserWindow | null): MenuItemConstructorOptions => ({
  role: 'help',
  submenu: [
    {
      label: 'Setup Wizard...',
      click: () => sendToRenderer(mainWindow, CHANNELS.menuShowSetupWizard),
    },
    {
      label: 'Prerequisites...',
      click: () => sendToRenderer(mainWindow, CHANNELS.menuShowPrerequisites),
    },
    {
      label: 'Model Manager...',
      click: () => sendToRenderer(mainWindow, CHANNELS.menuShowModelManager),
    },
    { type: 'separator' },
    {
      label: 'Learn More',
      click: () => {
        void shell.openExternal('https://github.com/anthropics/claude-code');
      },
    },
  ],
});
