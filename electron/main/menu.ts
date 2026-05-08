import { app, BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron';

/**
 * Create the native macOS application menu.
 *
 * Menu structure:
 * - App Menu (About, Settings, Quit)
 * - File (Open Folder, Recent Folders, Close)
 * - Edit (standard edit commands)
 * - View (Toggle Terminal Log, Zoom)
 * - Help (Prerequisites, Model Manager, About)
 */
export function createApplicationMenu(mainWindow: BrowserWindow | null): void {
  const isMac = process.platform === 'darwin';

  // Helper to send IPC message to renderer
  const sendToRenderer = (channel: string, ...args: unknown[]): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  };

  // App menu (macOS only)
  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      {
        label: 'Settings...',
        accelerator: 'Cmd+,',
        click: () => sendToRenderer('menu:showSettings'),
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
  };

  // File menu
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'Open Folder...',
        accelerator: 'CmdOrCtrl+O',
        click: () => sendToRenderer('menu:openFolder'),
      },
      {
        label: 'Recent Folders',
        role: 'recentDocuments' as const,
        submenu: [
          {
            label: 'Clear Recent',
            click: () => sendToRenderer('menu:clearRecentFolders'),
          },
        ],
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  // Edit menu
  const editMenu: MenuItemConstructorOptions = {
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
  };

  // View menu
  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Toggle Terminal Log',
        accelerator: 'CmdOrCtrl+T',
        click: () => sendToRenderer('menu:toggleTerminal'),
      },
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+B',
        click: () => sendToRenderer('menu:toggleSidebar'),
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
  };

  // Window menu
  const windowMenu: MenuItemConstructorOptions = {
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
  };

  // Help menu
  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      {
        label: 'Prerequisites...',
        click: () => sendToRenderer('menu:showPrerequisites'),
      },
      {
        label: 'Model Manager...',
        click: () => sendToRenderer('menu:showModelManager'),
      },
      { type: 'separator' },
      {
        label: 'Learn More',
        click: async () => {
          await shell.openExternal('https://github.com/anthropics/claude-code');
        },
      },
    ],
  };

  // Build the menu template
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ];

  // Build and set the menu
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Update the Recent Folders submenu with the current list of recent folders.
 * This should be called whenever the recent folders list changes.
 */
export function updateRecentFoldersMenu(
  mainWindow: BrowserWindow | null,
  recentFolders: string[]
): void {
  // Recreate the entire menu with updated recent folders
  // This is the standard way to update menus in Electron
  const isMac = process.platform === 'darwin';

  // Helper to send IPC message to renderer
  const sendToRenderer = (channel: string, ...args: unknown[]): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  };

  // Build recent folders submenu items
  const recentFolderItems: MenuItemConstructorOptions[] = recentFolders.map(
    (folder) => ({
      label: folder.split('/').pop() || folder,
      click: () => sendToRenderer('menu:openRecentFolder', folder),
    })
  );

  // App menu (macOS only)
  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      {
        label: 'Settings...',
        accelerator: 'Cmd+,',
        click: () => sendToRenderer('menu:showSettings'),
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
  };

  // File menu with updated recent folders
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'Open Folder...',
        accelerator: 'CmdOrCtrl+O',
        click: () => sendToRenderer('menu:openFolder'),
      },
      {
        label: 'Recent Folders',
        enabled: recentFolderItems.length > 0,
        submenu: [
          ...recentFolderItems,
          ...(recentFolderItems.length > 0 ? [{ type: 'separator' as const }] : []),
          {
            label: 'Clear Recent',
            enabled: recentFolderItems.length > 0,
            click: () => sendToRenderer('menu:clearRecentFolders'),
          },
        ],
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  // Edit menu
  const editMenu: MenuItemConstructorOptions = {
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
  };

  // View menu
  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Toggle Terminal Log',
        accelerator: 'CmdOrCtrl+T',
        click: () => sendToRenderer('menu:toggleTerminal'),
      },
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+B',
        click: () => sendToRenderer('menu:toggleSidebar'),
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
  };

  // Window menu
  const windowMenu: MenuItemConstructorOptions = {
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
  };

  // Help menu
  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      {
        label: 'Prerequisites...',
        click: () => sendToRenderer('menu:showPrerequisites'),
      },
      {
        label: 'Model Manager...',
        click: () => sendToRenderer('menu:showModelManager'),
      },
      { type: 'separator' },
      {
        label: 'Learn More',
        click: async () => {
          await shell.openExternal('https://github.com/anthropics/claude-code');
        },
      },
    ],
  };

  // Build the menu template
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ];

  // Build and set the menu
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
