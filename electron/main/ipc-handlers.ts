/**
 * IPC Handlers for Main Process
 * Bridge between renderer and backend services
 */
import { ipcMain, dialog, shell, app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getMainWindow } from './window.js';
import { getFFmpegInfo } from './ffmpeg-setup.js';

const execAsync = promisify(exec);

// Import existing services from CLI (these will be reused)
// Note: These imports will work once we update the tsconfig
// import { scanDirectory, extractFrames, transcribeAudio, analyzeVideo, renameVideo } from '../../src/services/index.js';
// import { initDatabase, getVideoByPath, getAllVideos, updateVideoStatus } from '../../src/db/index.js';

/**
 * Check if a command is available on the system
 */
async function checkCommand(command: string): Promise<{ available: boolean; version: string | null; path: string | null }> {
  try {
    const { stdout } = await execAsync(`which ${command}`);
    const path = stdout.trim();

    // Try to get version
    let version: string | null = null;
    try {
      const { stdout: versionOutput } = await execAsync(`${command} --version 2>&1 || ${command} -v 2>&1`);
      version = versionOutput.trim().split('\n')[0];
    } catch {
      // Version check failed, but command exists
    }

    return { available: true, version, path };
  } catch {
    return { available: false, version: null, path: null };
  }
}

/**
 * Check if Ollama is installed and running
 */
async function checkOllama(): Promise<{ installed: boolean; running: boolean; version: string | null }> {
  const commandCheck = await checkCommand('ollama');
  if (!commandCheck.available) {
    return { installed: false, running: false, version: null };
  }

  // Check if Ollama is running by trying to list models
  try {
    await execAsync('ollama list');
    return { installed: true, running: true, version: commandCheck.version };
  } catch {
    return { installed: true, running: false, version: commandCheck.version };
  }
}

/**
 * Check for Claude API key in environment
 */
function checkClaudeApiKey(): { available: boolean } {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  return { available: !!apiKey };
}

/**
 * Check for OpenAI API key in environment (for Whisper API)
 */
function checkOpenAIApiKey(): { available: boolean } {
  const apiKey = process.env.OPENAI_API_KEY;
  return { available: !!apiKey };
}

/**
 * Check for whisper.cpp or whisper CLI
 */
async function checkWhisper(): Promise<{ available: boolean; version: string | null; path: string | null; type: 'whisper.cpp' | 'whisper' | null }> {
  // First check for whisper.cpp (preferred)
  const whisperCpp = await checkCommand('whisper.cpp');
  if (whisperCpp.available) {
    return { ...whisperCpp, type: 'whisper.cpp' };
  }

  // Check for main (whisper.cpp binary is often called "main")
  const main = await checkCommand('main');
  if (main.available && main.version?.includes('whisper')) {
    return { ...main, type: 'whisper.cpp' };
  }

  // Check for whisper CLI (OpenAI's Python implementation)
  const whisper = await checkCommand('whisper');
  if (whisper.available) {
    return { ...whisper, type: 'whisper' };
  }

  return { available: false, version: null, path: null, type: null };
}

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
    // Run all checks in parallel for performance
    const [ffmpegInfo, whisperInfo, ollamaInfo] = await Promise.all([
      getFFmpegInfo(),
      checkWhisper(),
      checkOllama(),
    ]);

    const claudeInfo = checkClaudeApiKey();
    const openaiInfo = checkOpenAIApiKey();

    // Determine available analysis methods
    const analysisMethods: string[] = [];
    if (claudeInfo.available) analysisMethods.push('Claude API');
    if (ollamaInfo.running) analysisMethods.push('Ollama (LLaVA)');

    // Determine available transcription methods
    const transcriptionMethods: string[] = [];
    if (whisperInfo.available) {
      transcriptionMethods.push(whisperInfo.type === 'whisper.cpp' ? 'whisper.cpp (local)' : 'Whisper CLI (local)');
    }
    if (openaiInfo.available) transcriptionMethods.push('OpenAI Whisper API');

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
      whisper: {
        available: whisperInfo.available,
        version: whisperInfo.version,
        path: whisperInfo.path,
        type: whisperInfo.type,
      },
      claude: {
        available: claudeInfo.available,
      },
      ollama: {
        installed: ollamaInfo.installed,
        running: ollamaInfo.running,
        version: ollamaInfo.version,
      },
      openaiKey: {
        available: openaiInfo.available,
      },
      // Summary of available methods
      analysisMethods,
      transcriptionMethods,
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
