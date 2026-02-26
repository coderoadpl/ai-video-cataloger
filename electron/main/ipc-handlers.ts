/**
 * IPC Handlers for Main Process
 * Bridge between renderer and backend services
 */
import { ipcMain, dialog, shell, app } from 'electron';
import { getMainWindow } from './window.js';
import { getFFmpegInfo } from './ffmpeg-setup.js';

// Import existing services from CLI (these will be reused)
// Note: These imports will work once we update the tsconfig
// import { scanDirectory, extractFrames, transcribeAudio, analyzeVideo, renameVideo } from '../../src/services/index.js';
// import { initDatabase, getVideoByPath, getAllVideos, updateVideoStatus } from '../../src/db/index.js';

export function registerIpcHandlers(): void {
  // Folder selection
  ipcMain.handle('select-folder', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select a folder containing videos',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Scan folder for video files
  ipcMain.handle('scan-folder', async (_event, _folderPath: string) => {
    // TODO: Implement using scanDirectory service
    // For now, return empty array
    return [];
  });

  // Get video details
  ipcMain.handle('get-video-details', async (_event, _videoId: number) => {
    // TODO: Implement using getVideoById service
    return null;
  });

  // Process single video
  ipcMain.handle('process-video', async (_event, _videoId: number) => {
    // TODO: Implement full processing pipeline
    // extractFrames -> extractAudio -> transcribeAudio -> analyzeVideo -> renameVideo
    return { success: false, error: 'Not implemented' };
  });

  // Process batch of videos
  ipcMain.handle('process-batch', async (_event, _videoIds: number[]) => {
    // TODO: Implement batch processing
    return { success: false, error: 'Not implemented' };
  });

  // Cancel processing
  ipcMain.handle('cancel-processing', async () => {
    // TODO: Implement cancellation
    return { success: true };
  });

  // Get settings
  ipcMain.handle('get-settings', async () => {
    // TODO: Implement using getConfig service
    return {
      analysisMethod: 'claude',
      transcriptionMethod: 'local',
      frameCount: 3,
      renameFiles: true,
    };
  });

  // Save settings
  ipcMain.handle('save-settings', async (_event, _settings: Record<string, unknown>) => {
    // TODO: Implement using setConfig service
    return { success: true };
  });

  // Reveal in Finder
  ipcMain.handle('reveal-in-finder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  // Get app paths
  ipcMain.handle('get-app-paths', async () => {
    return {
      userData: app.getPath('userData'),
      temp: app.getPath('temp'),
      home: app.getPath('home'),
    };
  });

  // Check prerequisites
  ipcMain.handle('check-prerequisites', async () => {
    // Get FFmpeg info using bundled binary
    const ffmpegInfo = await getFFmpegInfo();

    return {
      ffmpeg: {
        available: ffmpegInfo.version !== 'not found',
        version: ffmpegInfo.version,
        bundled: ffmpegInfo.bundled,
        path: ffmpegInfo.ffmpegPath,
      },
      ffprobe: {
        available: ffmpegInfo.version !== 'not found',
        path: ffmpegInfo.ffprobePath,
      },
      whisper: { available: false, version: null },
      claude: { available: false, version: null },
      ollama: { available: false, running: false },
      openaiKey: { available: false },
    };
  });

  // Whisper model management
  ipcMain.handle('get-whisper-models', async () => {
    // TODO: Implement model listing
    return [];
  });

  ipcMain.handle('download-whisper-model', async (_event, _modelName: string) => {
    // TODO: Implement model download
    return { success: false, error: 'Not implemented' };
  });

  ipcMain.handle('delete-whisper-model', async (_event, _modelName: string) => {
    // TODO: Implement model deletion
    return { success: false, error: 'Not implemented' };
  });

  // Ollama/LLaVA management
  ipcMain.handle('get-ollama-status', async () => {
    // TODO: Implement Ollama status check
    return { installed: false, running: false };
  });

  ipcMain.handle('get-llava-models', async () => {
    // TODO: Implement LLaVA model listing
    return [];
  });

  ipcMain.handle('pull-llava-model', async (_event, _variant: string) => {
    // TODO: Implement model pulling
    return { success: false, error: 'Not implemented' };
  });

  ipcMain.handle('remove-llava-model', async (_event, _variant: string) => {
    // TODO: Implement model removal
    return { success: false, error: 'Not implemented' };
  });
}
