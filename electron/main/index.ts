/**
 * Electron Main Process Entry Point
 */
import { app, BrowserWindow, protocol, net } from 'electron';
import { createWindow, getMainWindow, saveWindowState } from './window.js';
import { setupMenu } from './menu.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { configureFfmpeg } from './ffmpeg-setup.js';
import { pathToFileURL } from 'url';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === 'win32') {
  app.quit();
}

// Register custom protocol scheme before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-file',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  // Register custom protocol to serve local files
  protocol.handle('local-file', (request) => {
    const filePath = decodeURIComponent(request.url.replace('local-file://', ''));
    return net.fetch(pathToFileURL(filePath).toString());
  });

  // Configure FFmpeg to use bundled binaries
  configureFfmpeg();

  // Register IPC handlers before creating window
  registerIpcHandlers();

  // Create the main window
  await createWindow();

  // Setup native macOS menu
  setupMenu();

  app.on('activate', async () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Save window state before quitting
app.on('before-quit', () => {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    saveWindowState(mainWindow);
  }
});

// Handle open-file events on macOS (when user opens video file with the app)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  // TODO: Handle opening specific file
  console.log('Open file:', filePath);
});
