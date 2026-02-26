/**
 * IPC Handlers for Main Process
 * Bridge between renderer and backend services
 */
import { ipcMain, dialog, shell, app } from 'electron';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { getMainWindow } from './window.js';
import { getFFmpegInfo } from './ffmpeg-setup.js';
import { getWhisperCppPath, isBundledWhisperCppAvailable, getWhisperCppInfo } from './whisper-paths.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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

// Whisper transcription settings stored in user preferences
interface WhisperSettings {
  preferBuiltIn: boolean; // true = prefer bundled whisper.cpp, false = prefer system whisper
  selectedModel: string;  // Model name (e.g., 'base', 'small', 'medium')
}

// Active transcription process for cancellation
let activeTranscription: {
  process: ReturnType<typeof spawn> | null;
  audioPath: string;
} | null = null;

/**
 * Get available whisper.cpp binary path - checks bundled first, then system
 * @param preferBuiltIn - Whether to prefer bundled binary over system
 */
async function getAvailableWhisperPath(preferBuiltIn: boolean): Promise<{
  path: string;
  type: 'bundled' | 'system-whisper.cpp' | 'system-whisper' | null;
}> {
  // Check bundled whisper.cpp
  const bundledAvailable = isBundledWhisperCppAvailable();
  const bundledPath = getWhisperCppPath();

  // Check system whisper.cpp
  const systemWhisperCpp = await checkCommand('whisper.cpp');
  const systemMain = await checkCommand('main');
  const systemWhisper = await checkCommand('whisper');

  // Determine system whisper.cpp availability
  let systemWhisperCppPath = '';
  if (systemWhisperCpp.available && systemWhisperCpp.path) {
    systemWhisperCppPath = systemWhisperCpp.path;
  } else if (systemMain.available && systemMain.path && systemMain.version?.includes('whisper')) {
    systemWhisperCppPath = systemMain.path;
  }

  if (preferBuiltIn) {
    // Prefer bundled, fall back to system
    if (bundledAvailable) {
      return { path: bundledPath, type: 'bundled' };
    }
    if (systemWhisperCppPath) {
      return { path: systemWhisperCppPath, type: 'system-whisper.cpp' };
    }
    if (systemWhisper.available && systemWhisper.path) {
      return { path: systemWhisper.path, type: 'system-whisper' };
    }
  } else {
    // Prefer system, fall back to bundled
    if (systemWhisperCppPath) {
      return { path: systemWhisperCppPath, type: 'system-whisper.cpp' };
    }
    if (systemWhisper.available && systemWhisper.path) {
      return { path: systemWhisper.path, type: 'system-whisper' };
    }
    if (bundledAvailable) {
      return { path: bundledPath, type: 'bundled' };
    }
  }

  return { path: '', type: null };
}

/**
 * Transcribe audio file using whisper.cpp
 * @param audioPath - Path to the audio file (WAV format, 16kHz mono)
 * @param modelPath - Path to the GGML model file
 * @param outputDir - Directory to save transcript
 */
async function transcribeWithWhisperCpp(
  audioPath: string,
  modelPath: string,
  outputDir: string
): Promise<{ success: boolean; transcript: string; outputPath: string; error?: string }> {
  const mainWindow = getMainWindow();
  const baseName = path.basename(audioPath, path.extname(audioPath));

  return new Promise((resolve) => {
    // whisper.cpp command line arguments:
    // -m <model>   : path to model file
    // -f <file>    : input audio file
    // -otxt        : output as plain text
    // -of <path>   : output file path (without extension)
    // --no-prints  : suppress non-transcript output
    const whisperPath = getWhisperCppPath();

    if (!whisperPath) {
      resolve({
        success: false,
        transcript: '',
        outputPath: '',
        error: 'Whisper.cpp binary not found',
      });
      return;
    }

    const outputBase = path.join(outputDir, baseName);
    const args = [
      '-m', modelPath,
      '-f', audioPath,
      '-otxt',
      '-of', outputBase,
      '--no-prints',
    ];

    const whisperProcess = spawn(whisperPath, args);
    activeTranscription = { process: whisperProcess, audioPath };

    let stderr = '';

    whisperProcess.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      // Send progress update
      mainWindow?.webContents.send('transcription:progress', {
        audioPath,
        status: 'transcribing',
        message: data.toString().trim(),
      });
    });

    whisperProcess.on('close', (code) => {
      activeTranscription = null;

      if (code === 0) {
        // Read the output file
        const txtPath = `${outputBase}.txt`;
        try {
          const transcript = fs.existsSync(txtPath)
            ? fs.readFileSync(txtPath, 'utf-8').trim()
            : '';

          resolve({
            success: true,
            transcript,
            outputPath: txtPath,
          });
        } catch (err) {
          resolve({
            success: false,
            transcript: '',
            outputPath: '',
            error: `Failed to read transcript: ${err}`,
          });
        }
      } else {
        resolve({
          success: false,
          transcript: '',
          outputPath: '',
          error: `Whisper.cpp exited with code ${code}: ${stderr}`,
        });
      }
    });

    whisperProcess.on('error', (err) => {
      activeTranscription = null;
      resolve({
        success: false,
        transcript: '',
        outputPath: '',
        error: `Failed to start whisper.cpp: ${err.message}`,
      });
    });
  });
}

/**
 * Transcribe audio file using OpenAI's whisper CLI (Python implementation)
 * @param audioPath - Path to the audio file
 * @param model - Model name (tiny, base, small, medium, large-v3)
 * @param outputDir - Directory to save transcript
 */
async function transcribeWithSystemWhisper(
  audioPath: string,
  model: string,
  outputDir: string
): Promise<{ success: boolean; transcript: string; outputPath: string; error?: string }> {
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const outputPath = path.join(outputDir, `${baseName}.txt`);

  try {
    // whisper CLI: whisper <audio> --model <model> --output_dir <dir> --output_format txt
    await execFileAsync('whisper', [
      audioPath,
      '--model', model,
      '--output_dir', outputDir,
      '--output_format', 'txt',
    ], { timeout: 600000 }); // 10 minute timeout

    // Read the transcript
    const transcript = fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, 'utf-8').trim()
      : '';

    return {
      success: true,
      transcript,
      outputPath,
    };
  } catch (err) {
    return {
      success: false,
      transcript: '',
      outputPath: '',
      error: `Whisper CLI error: ${err instanceof Error ? err.message : err}`,
    };
  }
}

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

  // Whisper.cpp transcription
  ipcMain.handle('get-whisper-cpp-status', async () => {
    const bundledInfo = await getWhisperCppInfo();
    const systemWhisperCpp = await checkCommand('whisper.cpp');
    const systemMain = await checkCommand('main');
    const systemWhisper = await checkCommand('whisper');

    // Determine if system whisper.cpp is available
    let systemWhisperCppAvailable = false;
    let systemWhisperCppPath = '';
    if (systemWhisperCpp.available && systemWhisperCpp.path) {
      systemWhisperCppAvailable = true;
      systemWhisperCppPath = systemWhisperCpp.path;
    } else if (systemMain.available && systemMain.path && systemMain.version?.includes('whisper')) {
      systemWhisperCppAvailable = true;
      systemWhisperCppPath = systemMain.path;
    }

    return {
      bundled: {
        available: bundledInfo.available,
        path: bundledInfo.path,
        version: bundledInfo.version,
      },
      system: {
        whisperCpp: {
          available: systemWhisperCppAvailable,
          path: systemWhisperCppPath,
          version: systemWhisperCpp.version || systemMain.version,
        },
        whisperCli: {
          available: systemWhisper.available,
          path: systemWhisper.path,
          version: systemWhisper.version,
        },
      },
    };
  });

  ipcMain.handle('transcribe-audio', async (
    _event,
    options: {
      audioPath: string;
      modelName: string;
      outputDir: string;
      preferBuiltIn: boolean;
    }
  ) => {
    const { audioPath, modelName, outputDir, preferBuiltIn } = options;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Check if audio file exists
    if (!fs.existsSync(audioPath)) {
      return { success: false, error: `Audio file not found: ${audioPath}` };
    }

    // Get available whisper binary
    const whisperInfo = await getAvailableWhisperPath(preferBuiltIn);

    if (!whisperInfo.type) {
      return {
        success: false,
        error: 'No whisper.cpp or whisper CLI available. Please install whisper.cpp or download a model.',
      };
    }

    if (whisperInfo.type === 'bundled' || whisperInfo.type === 'system-whisper.cpp') {
      // Use whisper.cpp
      const modelsPath = getWhisperModelsPath();
      const modelInfo = WHISPER_MODELS[modelName];

      if (!modelInfo) {
        return { success: false, error: `Unknown model: ${modelName}` };
      }

      const modelPath = path.join(modelsPath, modelInfo.filename);

      if (!fs.existsSync(modelPath)) {
        return {
          success: false,
          error: `Model not downloaded: ${modelName}. Please download the model first.`,
        };
      }

      const result = await transcribeWithWhisperCpp(audioPath, modelPath, outputDir);
      return {
        ...result,
        method: whisperInfo.type,
      };
    } else {
      // Use system whisper CLI (Python)
      const result = await transcribeWithSystemWhisper(audioPath, modelName, outputDir);
      return {
        ...result,
        method: 'system-whisper',
      };
    }
  });

  ipcMain.handle('cancel-transcription', async () => {
    if (activeTranscription?.process) {
      activeTranscription.process.kill('SIGTERM');
      activeTranscription = null;
      return { success: true };
    }
    return { success: false, error: 'No active transcription to cancel' };
  });

  // Get/set whisper settings
  ipcMain.handle('get-whisper-settings', async () => {
    // For now, return default settings
    // In the future, these should be stored in the database
    return {
      preferBuiltIn: true,
      selectedModel: 'base',
    };
  });

  ipcMain.handle('save-whisper-settings', async (_event, settings: WhisperSettings) => {
    // For now, just acknowledge
    // In the future, save to database
    console.log('Saving whisper settings:', settings);
    return { success: true };
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
