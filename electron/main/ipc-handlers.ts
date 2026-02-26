/**
 * IPC Handlers for Main Process
 * Bridge between renderer and backend services
 */
import { ipcMain, dialog, shell, app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { getMainWindow } from './window.js';
import { getFFmpegInfo } from './ffmpeg-setup.js';

const execAsync = promisify(exec);

// Whisper GGML model definitions
interface WhisperModelInfo {
  name: string;
  filename: string;
  url: string;
}

const WHISPER_MODELS: Record<string, WhisperModelInfo> = {
  tiny: {
    name: 'tiny',
    filename: 'ggml-tiny.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  },
  'tiny.en': {
    name: 'tiny.en',
    filename: 'ggml-tiny.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  },
  base: {
    name: 'base',
    filename: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  },
  'base.en': {
    name: 'base.en',
    filename: 'ggml-base.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  },
  small: {
    name: 'small',
    filename: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  },
  'small.en': {
    name: 'small.en',
    filename: 'ggml-small.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  },
  medium: {
    name: 'medium',
    filename: 'ggml-medium.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
  },
  'medium.en': {
    name: 'medium.en',
    filename: 'ggml-medium.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
  },
  'large-v3': {
    name: 'large-v3',
    filename: 'ggml-large-v3.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
  },
};

// Track active download for cancellation
let activeDownload: {
  request: ReturnType<typeof https.get> | null;
  modelName: string;
} | null = null;

/**
 * Get the path where Whisper models are stored
 */
function getWhisperModelsPath(): string {
  const modelsDir = path.join(app.getPath('userData'), 'models', 'whisper');
  // Ensure directory exists
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
}

/**
 * Format bytes per second to human readable string
 */
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

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
    const modelsPath = getWhisperModelsPath();
    const models: { name: string; filename: string; path: string; sizeBytes: number }[] = [];

    try {
      const files = fs.readdirSync(modelsPath);
      for (const file of files) {
        if (file.startsWith('ggml-') && file.endsWith('.bin')) {
          const filePath = path.join(modelsPath, file);
          const stats = fs.statSync(filePath);
          // Extract model name from filename (e.g., "ggml-tiny.bin" -> "tiny")
          const modelName = file.replace('ggml-', '').replace('.bin', '');
          models.push({
            name: modelName,
            filename: file,
            path: filePath,
            sizeBytes: stats.size,
          });
        }
      }
    } catch (err) {
      console.error('Failed to list whisper models:', err);
    }

    return { models, modelsPath };
  });

  ipcMain.handle('download-whisper-model', async (_event, modelName: string) => {
    const modelInfo = WHISPER_MODELS[modelName];
    if (!modelInfo) {
      return { success: false, error: `Unknown model: ${modelName}` };
    }

    const modelsPath = getWhisperModelsPath();
    const destPath = path.join(modelsPath, modelInfo.filename);
    const tempPath = destPath + '.tmp';

    // Check if already downloaded
    if (fs.existsSync(destPath)) {
      return { success: true };
    }

    const mainWindow = getMainWindow();

    return new Promise((resolve) => {
      // Follow redirects manually for HTTPS
      const downloadWithRedirect = (url: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          resolve({ success: false, error: 'Too many redirects' });
          return;
        }

        const request = https.get(url, (response) => {
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              downloadWithRedirect(redirectUrl, redirectCount + 1);
              return;
            }
          }

          if (response.statusCode !== 200) {
            resolve({ success: false, error: `HTTP ${response.statusCode}` });
            return;
          }

          const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
          let downloadedBytes = 0;
          let lastTime = Date.now();
          let lastBytes = 0;

          const file = fs.createWriteStream(tempPath);
          activeDownload = { request, modelName };

          response.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;

            // Calculate speed every 500ms
            const now = Date.now();
            const timeDiff = now - lastTime;
            if (timeDiff >= 500) {
              const bytesDiff = downloadedBytes - lastBytes;
              const bytesPerSecond = (bytesDiff / timeDiff) * 1000;
              lastTime = now;
              lastBytes = downloadedBytes;

              // Send progress to renderer
              mainWindow?.webContents.send('model:download-progress', {
                modelName,
                bytesDownloaded: downloadedBytes,
                totalBytes,
                speed: formatSpeed(bytesPerSecond),
              });
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close(() => {
              // Rename temp file to final destination
              try {
                fs.renameSync(tempPath, destPath);
                activeDownload = null;
                mainWindow?.webContents.send('model:download-complete', {
                  success: true,
                  modelName,
                });
                resolve({ success: true });
              } catch (err) {
                activeDownload = null;
                mainWindow?.webContents.send('model:download-complete', {
                  success: false,
                  error: 'Failed to save model',
                  modelName,
                });
                resolve({ success: false, error: 'Failed to save model' });
              }
            });
          });

          file.on('error', (err) => {
            fs.unlink(tempPath, () => {}); // Clean up temp file
            activeDownload = null;
            mainWindow?.webContents.send('model:download-complete', {
              success: false,
              error: err.message,
              modelName,
            });
            resolve({ success: false, error: err.message });
          });
        });

        request.on('error', (err) => {
          fs.unlink(tempPath, () => {}); // Clean up temp file
          activeDownload = null;
          mainWindow?.webContents.send('model:download-complete', {
            success: false,
            error: err.message,
            modelName,
          });
          resolve({ success: false, error: err.message });
        });
      };

      downloadWithRedirect(modelInfo.url);
    });
  });

  ipcMain.handle('cancel-whisper-model-download', async () => {
    if (activeDownload?.request) {
      activeDownload.request.destroy();
      activeDownload = null;
      // Clean up any temp files
      const modelsPath = getWhisperModelsPath();
      const files = fs.readdirSync(modelsPath);
      for (const file of files) {
        if (file.endsWith('.tmp')) {
          try {
            fs.unlinkSync(path.join(modelsPath, file));
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }
    return { success: true };
  });

  ipcMain.handle('delete-whisper-model', async (_event, modelName: string) => {
    const modelInfo = WHISPER_MODELS[modelName];
    if (!modelInfo) {
      return { success: false, error: `Unknown model: ${modelName}` };
    }

    const modelsPath = getWhisperModelsPath();
    const modelPath = path.join(modelsPath, modelInfo.filename);

    try {
      if (fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: `Failed to delete model: ${err}` };
    }
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
