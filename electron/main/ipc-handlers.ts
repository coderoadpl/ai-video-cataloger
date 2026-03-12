/**
 * IPC Handlers for Main Process
 * Bridge between renderer and backend services
 */
import { ipcMain, dialog, shell, app } from 'electron';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import Store from 'electron-store';
import ffmpeg from 'fluent-ffmpeg';
import { getMainWindow } from './window.js';
import { getFFmpegInfo, configureFfmpeg } from './ffmpeg-setup.js';
import { getWhisperCppPath, isBundledWhisperCppAvailable, getWhisperCppInfo } from './whisper-paths.js';

// Video file extensions supported
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

// Thumbnails cache directory
function getThumbnailsCachePath(): string {
  const cacheDir = path.join(app.getPath('userData'), 'thumbnails');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

/**
 * Video file interface for the renderer
 */
interface ScannedVideoFile {
  id: number;
  filename: string;
  path: string;
  size: number;
  duration: number | undefined;
  modifiedDate: Date;
  status: 'none' | 'processing' | 'completed' | 'error';
  thumbnail: string | undefined;
  // Processed video data (populated when status is 'completed')
  summary?: string;
  transcript?: string;
  suggestedName?: string;
  frames?: string[];
  framesDir?: string;
  transcriptPath?: string;
  analysisMethod?: string;
  processedAt?: Date;
  // Error data (populated when status is 'error')
  errorMessage?: string;
  errorStep?: 'frame_extraction' | 'audio_extraction' | 'transcription' | 'analysis';
}

/**
 * Generate a unique ID for a video file based on its path
 */
function generateVideoId(filePath: string): number {
  // Simple hash of the path to generate a consistent ID
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get video duration using ffprobe
 */
async function getVideoDuration(videoPath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        resolve(undefined);
        return;
      }
      resolve(metadata.format.duration);
    });
  });
}

/**
 * Generate a thumbnail for a video
 */
async function generateThumbnail(videoPath: string): Promise<string | undefined> {
  const thumbnailsDir = getThumbnailsCachePath();
  const videoId = generateVideoId(videoPath);
  const thumbnailPath = path.join(thumbnailsDir, `${videoId}.jpg`);

  // Return existing thumbnail if it exists
  if (fs.existsSync(thumbnailPath)) {
    // Return as file:// URL for the renderer
    return `file://${thumbnailPath}`;
  }

  return new Promise((resolve) => {
    ffmpeg(videoPath)
      .seekInput(1) // Seek 1 second into video
      .frames(1)
      .size('128x72') // Small thumbnail size
      .output(thumbnailPath)
      .on('end', () => {
        resolve(`file://${thumbnailPath}`);
      })
      .on('error', () => {
        resolve(undefined);
      })
      .run();
  });
}

/**
 * Check if a video has been processed (look for frames directory)
 */
function getVideoStatus(videoPath: string): 'none' | 'processing' | 'completed' | 'error' {
  // Check if frames directory exists for this video
  const videoDir = path.dirname(videoPath);
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const framesDir = path.join(videoDir, 'frames', videoName);

  if (fs.existsSync(framesDir)) {
    try {
      const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg'));
      if (frames.length > 0) {
        return 'completed';
      }
    } catch {
      // Ignore errors reading directory
    }
  }

  return 'none';
}

/**
 * Load processed video data (frames, transcript, summary) for a completed video
 */
function loadProcessedVideoData(videoPath: string): {
  summary?: string;
  transcript?: string;
  suggestedName?: string;
  frames?: string[];
  framesDir?: string;
  transcriptPath?: string;
  analysisMethod?: string;
  processedAt?: Date;
} {
  const videoDir = path.dirname(videoPath);
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const result: ReturnType<typeof loadProcessedVideoData> = {};

  // Load frames
  const framesDir = path.join(videoDir, 'frames', videoName);
  if (fs.existsSync(framesDir)) {
    try {
      const frameFiles = fs.readdirSync(framesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort();
      if (frameFiles.length > 0) {
        result.frames = frameFiles.map(f => path.join(framesDir, f));
        result.framesDir = framesDir;
      }
    } catch {
      // Ignore errors
    }
  }

  // Load transcript
  const transcriptPath = path.join(videoDir, 'transcripts', `${videoName}.txt`);
  if (fs.existsSync(transcriptPath)) {
    try {
      result.transcript = fs.readFileSync(transcriptPath, 'utf-8').trim();
      result.transcriptPath = transcriptPath;
    } catch {
      // Ignore errors
    }
  }

  // Load summary (contains description and suggested filename)
  const summaryPath = path.join(videoDir, 'summaries', `${videoName}.txt`);
  if (fs.existsSync(summaryPath)) {
    try {
      const summaryContent = fs.readFileSync(summaryPath, 'utf-8');

      // Parse the summary file format:
      // Video: filename
      // Date Analyzed: ISO date string
      //
      // DESCRIPTION:
      // <description text>
      //
      // SUGGESTED FILENAME:
      // <filename>
      //
      // FULL ANALYSIS:
      // <full analysis text>

      // Extract description
      const descMatch = summaryContent.match(/DESCRIPTION:\n([\s\S]*?)(?=\n\nSUGGESTED FILENAME:|\n\nFULL ANALYSIS:|\Z)/);
      if (descMatch && descMatch[1]) {
        result.summary = descMatch[1].trim();
      }

      // Extract suggested filename
      const filenameMatch = summaryContent.match(/SUGGESTED FILENAME:\n([^\n]+)/);
      if (filenameMatch && filenameMatch[1]) {
        result.suggestedName = filenameMatch[1].trim();
      }

      // Extract date analyzed for processedAt
      const dateMatch = summaryContent.match(/Date Analyzed:\s*([^\n]+)/);
      if (dateMatch && dateMatch[1]) {
        const parsedDate = new Date(dateMatch[1].trim());
        if (!isNaN(parsedDate.getTime())) {
          result.processedAt = parsedDate;
        }
      }

      // Determine analysis method (default to 'claude' for CLI-processed videos)
      result.analysisMethod = 'claude';
    } catch {
      // Ignore errors
    }
  }

  return result;
}

/**
 * Scan a folder for video files with metadata
 */
async function scanFolderForVideos(folderPath: string): Promise<ScannedVideoFile[]> {
  // Ensure ffmpeg is configured
  configureFfmpeg();

  const videos: ScannedVideoFile[] = [];

  try {
    const entries = fs.readdirSync(folderPath);

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry);

      try {
        const stats = fs.statSync(fullPath);

        if (stats.isFile()) {
          const ext = path.extname(entry).toLowerCase();
          if (VIDEO_EXTENSIONS.includes(ext)) {
            // Get video metadata
            const [duration, thumbnail] = await Promise.all([
              getVideoDuration(fullPath),
              generateThumbnail(fullPath),
            ]);

            const status = getVideoStatus(fullPath);

            // Build the video object
            const videoFile: ScannedVideoFile = {
              id: generateVideoId(fullPath),
              filename: entry,
              path: fullPath,
              size: stats.size,
              duration,
              modifiedDate: stats.mtime,
              status,
              thumbnail,
            };

            // Load processed data for completed videos
            if (status === 'completed') {
              const processedData = loadProcessedVideoData(fullPath);
              Object.assign(videoFile, processedData);
            }

            videos.push(videoFile);
          }
        }
      } catch {
        // Skip files we can't stat (permission issues, etc.)
        continue;
      }
    }
  } catch (error) {
    console.error('Error scanning folder:', error);
    return [];
  }

  // Sort by filename by default
  return videos.sort((a, b) => a.filename.localeCompare(b.filename));
}

// Electron store for persisting folder history
interface FolderHistorySchema {
  recentFolders: string[];
  lastFolder: string | null;
}

const folderStore = new Store<FolderHistorySchema>({
  name: 'folder-history',
  defaults: {
    recentFolders: [],
    lastFolder: null,
  },
});

// Electron store for persisting app settings
interface AppSettingsSchema {
  analysisMethod: 'claude' | 'ollama';
  ollamaModel: string;
  transcriptionMethod: 'local' | 'api';
  whisperModel: string;
  preferBuiltInWhisper: boolean;
  frameCount: number;
  renameFiles: boolean;
}

const settingsStore = new Store<AppSettingsSchema>({
  name: 'app-settings',
  defaults: {
    analysisMethod: 'claude',
    ollamaModel: 'llava:7b',
    transcriptionMethod: 'local',
    whisperModel: 'base',
    preferBuiltInWhisper: true,
    frameCount: 3,
    renameFiles: true,
  },
});

const MAX_RECENT_FOLDERS = 10;

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
 * LLaVA model definitions with their characteristics
 */
interface LlavaModelInfo {
  name: string;
  tag: string;
  description: string;
  sizeGb: number;
  minRamGb: number;
}

const LLAVA_MODELS: LlavaModelInfo[] = [
  {
    name: 'llava',
    tag: 'llava:7b',
    description: 'LLaVA 1.5 7B - Good balance of quality and speed',
    sizeGb: 4.7,
    minRamGb: 8,
  },
  {
    name: 'llava',
    tag: 'llava:13b',
    description: 'LLaVA 1.5 13B - Higher quality, more resources',
    sizeGb: 8.0,
    minRamGb: 16,
  },
  {
    name: 'llava',
    tag: 'llava:34b',
    description: 'LLaVA 1.6 34B - Best quality, highest resources',
    sizeGb: 20.0,
    minRamGb: 32,
  },
];

/**
 * Get list of LLaVA models pulled in Ollama
 */
async function getOllamaPulledModels(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('ollama list');
    const lines = stdout.trim().split('\n').slice(1); // Skip header line
    const pulledModels: string[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0]) {
        pulledModels.push(parts[0]); // Model name with tag
      }
    }

    return pulledModels;
  } catch {
    return [];
  }
}

/**
 * Start Ollama service if installed but not running
 */
async function startOllama(): Promise<{ success: boolean; error?: string }> {
  const ollamaStatus = await checkOllama();

  if (!ollamaStatus.installed) {
    return { success: false, error: 'Ollama is not installed' };
  }

  if (ollamaStatus.running) {
    return { success: true };
  }

  try {
    // Start Ollama serve in background
    // On macOS, 'ollama serve' starts the server
    const ollamaProcess = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
    });
    ollamaProcess.unref();

    // Wait for Ollama to be ready (up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const status = await checkOllama();
      if (status.running) {
        return { success: true };
      }
    }

    return { success: false, error: 'Ollama started but not responding after 10 seconds' };
  } catch (err) {
    return {
      success: false,
      error: `Failed to start Ollama: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/**
 * Build the analysis prompt for LLaVA (same format as Claude for consistency)
 */
function buildLlavaAnalysisPrompt(videoName: string, transcript: string | null): string {
  let prompt = `You are analyzing a video file named "${videoName}".

`;

  if (transcript) {
    prompt += `Here is the transcript of the audio:
---
${transcript}
---

`;
  } else {
    prompt += `This video has no audio or transcript available.

`;
  }

  prompt += `Based on the visual content from the image(s)${transcript ? ' and the audio transcript' : ''}, please provide:

1. A 2-3 sentence description of what this video is about
2. A suggested filename (3-5 words, kebab-case format like "cat-playing-with-yarn")

Please format your response EXACTLY as follows:
DESCRIPTION: <your 2-3 sentence description here>
FILENAME: <your-suggested-filename-in-kebab-case>

Focus on being descriptive and accurate. The filename should capture the essence of the video content.`;

  return prompt;
}

/**
 * Parse LLaVA response to extract description and filename (same format as Claude)
 */
function parseLlavaResponse(response: string): { description: string; suggestedFilename: string } {
  const lines = response.trim().split('\n');

  let description = '';
  let suggestedFilename = '';
  let capturingDescription = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.toUpperCase().startsWith('DESCRIPTION:')) {
      description = trimmedLine.substring('DESCRIPTION:'.length).trim();
      capturingDescription = true;
    } else if (trimmedLine.toUpperCase().startsWith('FILENAME:')) {
      suggestedFilename = trimmedLine.substring('FILENAME:'.length).trim();
      capturingDescription = false;
    } else if (capturingDescription && trimmedLine && !trimmedLine.toUpperCase().startsWith('FILENAME')) {
      description += ' ' + trimmedLine;
    }
  }

  // Clean up the suggested filename (ensure kebab-case)
  suggestedFilename = suggestedFilename
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // If parsing failed, use the full response as description and generate a generic filename
  if (!description) {
    description = response.trim().substring(0, 500);
  }
  if (!suggestedFilename) {
    suggestedFilename = 'video-content';
  }

  return {
    description: description.trim(),
    suggestedFilename,
  };
}

// Active Ollama analysis for cancellation
let activeOllamaAnalysis: {
  abortController: AbortController | null;
} | null = null;

// Active video processing for cancellation
let activeVideoProcessing: {
  cancelled: boolean;
  videoPath: string;
} | null = null;

// Processing step types
type ProcessingStep = 'frame_extraction' | 'audio_extraction' | 'transcription' | 'analysis';

/**
 * Extract frames from a video at evenly distributed timestamps
 */
async function extractVideoFrames(
  videoPath: string,
  frameCount: number,
  onProgress: (message: string) => void
): Promise<{ success: boolean; framePaths?: string[]; framesDir?: string; error?: string }> {
  const videoDir = path.dirname(videoPath);
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const framesDir = path.join(videoDir, 'frames', videoName);

  // Create frames directory
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  // Get video duration
  const duration = await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const dur = metadata.format.duration;
      if (dur === undefined) {
        reject(new Error('Could not determine video duration'));
        return;
      }
      resolve(dur);
    });
  });

  // Calculate timestamps for frame extraction (evenly distributed)
  const timestamps: number[] = [];
  for (let i = 1; i <= frameCount; i++) {
    const percentage = i / (frameCount + 1);
    timestamps.push(duration * percentage);
  }

  // Extract frames
  const framePaths: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (activeVideoProcessing?.cancelled) {
      return { success: false, error: 'Processing cancelled' };
    }

    const frameNum = String(i + 1).padStart(3, '0');
    const framePath = path.join(framesDir, `frame-${frameNum}.jpg`);

    onProgress(`Extracting frame ${i + 1}/${frameCount}`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(timestamps[i])
        .frames(1)
        .output(framePath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    framePaths.push(framePath);
  }

  return { success: true, framePaths, framesDir };
}

/**
 * Check if a video has an audio track
 */
async function videoHasAudioTrack(videoPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const audioStreams = metadata.streams.filter(
        (stream) => stream.codec_type === 'audio'
      );
      resolve(audioStreams.length > 0);
    });
  });
}

/**
 * Extract audio from video to WAV file suitable for Whisper
 */
async function extractVideoAudio(
  videoPath: string,
  onProgress: (message: string) => void
): Promise<{ success: boolean; hasAudio: boolean; audioPath?: string; error?: string }> {
  onProgress('Checking audio track');

  const hasAudio = await videoHasAudioTrack(videoPath);
  if (!hasAudio) {
    return { success: true, hasAudio: false };
  }

  onProgress('Extracting audio');

  const videoName = path.basename(videoPath, path.extname(videoPath));
  const tempDir = path.join(app.getPath('temp'), 'ai-video-cataloger', 'audio');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const audioPath = path.join(tempDir, `${videoName}.wav`);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(audioPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });

  return { success: true, hasAudio: true, audioPath };
}

/**
 * Analyze video using Claude API via the claude CLI
 */
async function analyzeWithClaude(
  videoPath: string,
  framePaths: string[],
  transcript: string | null,
  onProgress: (message: string) => void
): Promise<{
  success: boolean;
  description?: string;
  suggestedFilename?: string;
  fullResponse?: string;
  error?: string;
}> {
  onProgress('Analyzing with Claude API');

  const videoName = path.basename(videoPath);
  const videoDir = path.dirname(videoPath);

  // Build the prompt
  let prompt = `You are analyzing a video file named "${videoName}".\n\n`;

  if (transcript) {
    prompt += `Here is the transcript of the audio:\n---\n${transcript}\n---\n\n`;
  } else {
    prompt += `This video has no audio or transcript available.\n\n`;
  }

  // Include frame images using file:// URLs
  prompt += `Here are ${framePaths.length} frame(s) extracted from the video:\n`;
  for (const framePath of framePaths) {
    prompt += `file://${framePath}\n`;
  }
  prompt += `\n`;

  prompt += `Based on the visual content from the frames${transcript ? ' and the audio transcript' : ''}, please provide:

1. A 2-3 sentence description of what this video is about
2. A suggested filename (3-5 words, kebab-case format like "cat-playing-with-yarn")

Please format your response EXACTLY as follows:
DESCRIPTION: <your 2-3 sentence description here>
FILENAME: <your-suggested-filename-in-kebab-case>

Focus on being descriptive and accurate. The filename should capture the essence of the video content.`;

  try {
    // Call Claude CLI
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const result = await execFileAsync('claude', [
      '--add-dir', videoDir,
      '-p', prompt
    ], { timeout: 120000 }); // 2 minute timeout

    const response = result.stdout;

    // Parse the response
    const parsed = parseLlavaResponse(response); // Same format as LLaVA

    return {
      success: true,
      description: parsed.description,
      suggestedFilename: parsed.suggestedFilename,
      fullResponse: response,
    };
  } catch (err) {
    return {
      success: false,
      error: `Claude analysis failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Save summary file for a processed video
 */
function saveSummaryFile(
  videoPath: string,
  description: string,
  suggestedFilename: string,
  fullResponse: string,
  analysisMethod: string
): string {
  const videoDir = path.dirname(videoPath);
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const summariesDir = path.join(videoDir, 'summaries');

  if (!fs.existsSync(summariesDir)) {
    fs.mkdirSync(summariesDir, { recursive: true });
  }

  const summaryPath = path.join(summariesDir, `${videoName}.txt`);
  const summaryContent = `Video: ${path.basename(videoPath)}
Date Analyzed: ${new Date().toISOString()}
Analysis Method: ${analysisMethod}

DESCRIPTION:
${description}

SUGGESTED FILENAME:
${suggestedFilename}

FULL ANALYSIS:
${fullResponse}
`;

  fs.writeFileSync(summaryPath, summaryContent, 'utf-8');
  return summaryPath;
}

/**
 * Clean up temporary audio file
 */
function cleanupTempAudio(audioPath: string): void {
  try {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  } catch {
    // Best effort cleanup
  }
}

/**
 * Process a single video through the full pipeline
 */
async function processVideoFull(
  videoPath: string,
  videoId: number,
  settings: {
    frameCount: number;
    analysisMethod: 'claude' | 'ollama';
    ollamaModel: string;
    whisperModel: string;
    preferBuiltInWhisper: boolean;
  }
): Promise<{ success: boolean; error?: string; errorStep?: ProcessingStep }> {
  const mainWindow = getMainWindow();

  // Set up active processing state for cancellation
  activeVideoProcessing = { cancelled: false, videoPath };

  const sendProgress = (step: string, percent: number = 0) => {
    mainWindow?.webContents.send('processing:progress', {
      videoId,
      step,
      percent,
    });
  };

  const sendError = (error: string, step: ProcessingStep) => {
    mainWindow?.webContents.send('processing:error', {
      videoId,
      error,
      step,
    });
  };

  const sendComplete = (success: boolean) => {
    mainWindow?.webContents.send('processing:complete', {
      videoId,
      success,
    });
  };

  let tempAudioPath: string | null = null;

  try {
    // Ensure ffmpeg is configured
    configureFfmpeg();

    // Step 1: Extract frames
    sendProgress('Extracting frames', 10);
    const frameResult = await extractVideoFrames(
      videoPath,
      settings.frameCount,
      (msg) => sendProgress(`Frame extraction: ${msg}`, 20)
    );

    if (!frameResult.success || !frameResult.framePaths) {
      const error = frameResult.error || 'Failed to extract frames';
      sendError(error, 'frame_extraction');
      sendComplete(false);
      activeVideoProcessing = null;
      return { success: false, error, errorStep: 'frame_extraction' };
    }

    if (activeVideoProcessing?.cancelled) {
      sendComplete(false);
      activeVideoProcessing = null;
      return { success: false, error: 'Processing cancelled' };
    }

    // Step 2: Extract audio
    sendProgress('Extracting audio', 30);
    const audioResult = await extractVideoAudio(
      videoPath,
      (msg) => sendProgress(`Audio extraction: ${msg}`, 35)
    );

    if (!audioResult.success) {
      const error = audioResult.error || 'Failed to extract audio';
      sendError(error, 'audio_extraction');
      sendComplete(false);
      activeVideoProcessing = null;
      return { success: false, error, errorStep: 'audio_extraction' };
    }

    tempAudioPath = audioResult.audioPath || null;

    if (activeVideoProcessing?.cancelled) {
      if (tempAudioPath) cleanupTempAudio(tempAudioPath);
      sendComplete(false);
      activeVideoProcessing = null;
      return { success: false, error: 'Processing cancelled' };
    }

    // Step 3: Transcribe audio (if audio exists)
    let transcript: string | null = null;
    let transcriptPath: string | null = null;

    if (audioResult.hasAudio && tempAudioPath) {
      sendProgress('Transcribing audio', 40);

      // Create transcripts directory
      const videoDir = path.dirname(videoPath);
      const videoName = path.basename(videoPath, path.extname(videoPath));
      const transcriptsDir = path.join(videoDir, 'transcripts');
      if (!fs.existsSync(transcriptsDir)) {
        fs.mkdirSync(transcriptsDir, { recursive: true });
      }

      // Determine which whisper to use
      const whisperInfo = await getAvailableWhisperPath(settings.preferBuiltInWhisper);

      if (whisperInfo.type) {
        if (whisperInfo.type === 'bundled' || whisperInfo.type === 'system-whisper.cpp') {
          // Use whisper.cpp
          const modelsPath = getWhisperModelsPath();
          const modelInfo = WHISPER_MODELS[settings.whisperModel];

          if (modelInfo) {
            const modelPath = path.join(modelsPath, modelInfo.filename);

            if (fs.existsSync(modelPath)) {
              const transcriptResult = await transcribeWithWhisperCpp(
                tempAudioPath,
                modelPath,
                transcriptsDir
              );

              if (transcriptResult.success) {
                transcript = transcriptResult.transcript;
                transcriptPath = transcriptResult.outputPath;
              }
            }
          }
        } else if (whisperInfo.type === 'system-whisper') {
          // Use system whisper CLI
          const transcriptResult = await transcribeWithSystemWhisper(
            tempAudioPath,
            settings.whisperModel,
            transcriptsDir
          );

          if (transcriptResult.success) {
            transcript = transcriptResult.transcript;
            transcriptPath = transcriptResult.outputPath;
          }
        }
      }

      // Copy transcript to the correct location if needed
      if (transcript && !transcriptPath) {
        transcriptPath = path.join(transcriptsDir, `${videoName}.txt`);
        fs.writeFileSync(transcriptPath, transcript, 'utf-8');
      }
    }

    if (activeVideoProcessing?.cancelled) {
      if (tempAudioPath) cleanupTempAudio(tempAudioPath);
      sendComplete(false);
      activeVideoProcessing = null;
      return { success: false, error: 'Processing cancelled' };
    }

    // Step 4: Analyze video
    sendProgress('Analyzing video', 60);

    let analysisResult: {
      success: boolean;
      description?: string;
      suggestedFilename?: string;
      fullResponse?: string;
      error?: string;
    };

    const videoName = path.basename(videoPath, path.extname(videoPath));

    if (settings.analysisMethod === 'ollama') {
      analysisResult = await analyzeWithOllama(
        frameResult.framePaths,
        videoName,
        transcript,
        settings.ollamaModel
      );
    } else {
      // Use Claude API via CLI
      analysisResult = await analyzeWithClaude(
        videoPath,
        frameResult.framePaths,
        transcript,
        (msg) => sendProgress(`Analysis: ${msg}`, 70)
      );
    }

    if (!analysisResult.success || !analysisResult.description) {
      const error = analysisResult.error || 'Failed to analyze video';
      sendError(error, 'analysis');
      sendComplete(false);
      if (tempAudioPath) cleanupTempAudio(tempAudioPath);
      activeVideoProcessing = null;
      return { success: false, error, errorStep: 'analysis' };
    }

    // Step 5: Save summary file
    sendProgress('Saving results', 90);
    saveSummaryFile(
      videoPath,
      analysisResult.description,
      analysisResult.suggestedFilename || 'video-content',
      analysisResult.fullResponse || analysisResult.description,
      settings.analysisMethod
    );

    // Clean up temp audio
    if (tempAudioPath) cleanupTempAudio(tempAudioPath);

    sendProgress('Complete', 100);
    sendComplete(true);
    activeVideoProcessing = null;

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    sendError(error, 'frame_extraction'); // Default to first step
    sendComplete(false);
    if (tempAudioPath) cleanupTempAudio(tempAudioPath);
    activeVideoProcessing = null;
    return { success: false, error };
  }
}

/**
 * Analyze images with Ollama LLaVA
 * @param imagePaths - Array of paths to image files (frames)
 * @param videoName - Name of the video being analyzed
 * @param transcript - Optional transcript text
 * @param modelTag - Ollama model tag to use (e.g., 'llava:7b')
 */
async function analyzeWithOllama(
  imagePaths: string[],
  videoName: string,
  transcript: string | null,
  modelTag: string
): Promise<{
  success: boolean;
  description?: string;
  suggestedFilename?: string;
  fullResponse?: string;
  error?: string
}> {
  const mainWindow = getMainWindow();

  // Ensure Ollama is running
  const ollamaStatus = await checkOllama();
  if (!ollamaStatus.running) {
    const startResult = await startOllama();
    if (!startResult.success) {
      return { success: false, error: startResult.error || 'Failed to start Ollama' };
    }
  }

  // Read images and convert to base64
  const images: string[] = [];
  for (const imagePath of imagePaths) {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      images.push(base64Image);
    } catch (err) {
      return {
        success: false,
        error: `Failed to read image ${imagePath}: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  if (images.length === 0) {
    return { success: false, error: 'No images provided for analysis' };
  }

  // Build the prompt
  const prompt = buildLlavaAnalysisPrompt(videoName, transcript);

  // Create abort controller for cancellation
  const abortController = new AbortController();
  activeOllamaAnalysis = { abortController };

  try {
    // Call Ollama API
    // Ollama exposes a REST API at http://localhost:11434
    const requestBody = JSON.stringify({
      model: modelTag,
      prompt: prompt,
      images: images, // Array of base64 encoded images
      stream: false,
    });

    mainWindow?.webContents.send('ollama:analysis-progress', {
      status: 'analyzing',
      message: `Analyzing with ${modelTag}...`,
    });

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBody,
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Ollama API error (${response.status}): ${errorText}`
      };
    }

    const result = await response.json() as { response: string };
    const fullResponse = result.response;

    // Parse the response
    const parsed = parseLlavaResponse(fullResponse);

    activeOllamaAnalysis = null;

    return {
      success: true,
      description: parsed.description,
      suggestedFilename: parsed.suggestedFilename,
      fullResponse,
    };
  } catch (err) {
    activeOllamaAnalysis = null;

    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Analysis cancelled' };
    }

    return {
      success: false,
      error: `Ollama analysis failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/**
 * Cancel active Ollama analysis
 */
function cancelOllamaAnalysis(): boolean {
  if (activeOllamaAnalysis?.abortController) {
    activeOllamaAnalysis.abortController.abort();
    activeOllamaAnalysis = null;
    return true;
  }
  return false;
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

    // Get the last folder to use as default location
    const lastFolder = folderStore.get('lastFolder');

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select a folder containing videos',
      defaultPath: lastFolder || undefined,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedFolder = result.filePaths[0];

    // Save as last folder and add to recent folders
    folderStore.set('lastFolder', selectedFolder);

    // Update recent folders list
    let recentFolders = folderStore.get('recentFolders');
    // Remove if already exists (to move it to the front)
    recentFolders = recentFolders.filter(f => f !== selectedFolder);
    // Add to the beginning
    recentFolders.unshift(selectedFolder);
    // Keep only the most recent
    recentFolders = recentFolders.slice(0, MAX_RECENT_FOLDERS);
    folderStore.set('recentFolders', recentFolders);

    return selectedFolder;
  });

  // Get recent folders
  ipcMain.handle('get-recent-folders', async () => {
    const recentFolders = folderStore.get('recentFolders');
    // Filter out folders that no longer exist
    const existingFolders = recentFolders.filter(folder => {
      try {
        return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
      } catch {
        return false;
      }
    });
    // Update store if some folders were removed
    if (existingFolders.length !== recentFolders.length) {
      folderStore.set('recentFolders', existingFolders);
    }
    return existingFolders;
  });

  // Get last used folder
  ipcMain.handle('get-last-folder', async () => {
    const lastFolder = folderStore.get('lastFolder');
    // Verify it still exists
    if (lastFolder) {
      try {
        if (fs.existsSync(lastFolder) && fs.statSync(lastFolder).isDirectory()) {
          return lastFolder;
        }
      } catch {
        // Folder doesn't exist anymore
      }
      // Clear if no longer valid
      folderStore.set('lastFolder', null);
    }
    return null;
  });

  // Set folder as current (for when opening from recent list)
  ipcMain.handle('set-current-folder', async (_event, folderPath: string) => {
    // Verify folder exists
    try {
      if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return { success: false, error: 'Folder does not exist' };
      }
    } catch {
      return { success: false, error: 'Folder does not exist' };
    }

    // Save as last folder and update recent folders
    folderStore.set('lastFolder', folderPath);

    let recentFolders = folderStore.get('recentFolders');
    recentFolders = recentFolders.filter(f => f !== folderPath);
    recentFolders.unshift(folderPath);
    recentFolders = recentFolders.slice(0, MAX_RECENT_FOLDERS);
    folderStore.set('recentFolders', recentFolders);

    return { success: true };
  });

  // Scan folder for video files
  ipcMain.handle('scan-folder', async (_event, folderPath: string) => {
    return await scanFolderForVideos(folderPath);
  });

  // Get video details
  ipcMain.handle('get-video-details', async (_event, _videoId: number) => {
    // TODO: Implement using getVideoById service
    return null;
  });

  // Process single video
  ipcMain.handle('process-video', async (_event, videoPath: string) => {
    // Get current settings
    const settings = {
      frameCount: settingsStore.get('frameCount'),
      analysisMethod: settingsStore.get('analysisMethod'),
      ollamaModel: settingsStore.get('ollamaModel'),
      whisperModel: settingsStore.get('whisperModel'),
      preferBuiltInWhisper: settingsStore.get('preferBuiltInWhisper'),
    };

    // Generate video ID from path (same as scanFolderForVideos)
    const videoId = generateVideoId(videoPath);

    return await processVideoFull(videoPath, videoId, settings);
  });

  // Process batch of videos
  ipcMain.handle('process-batch', async (_event, _videoIds: number[]) => {
    // TODO: Implement batch processing
    return { success: false, error: 'Not implemented' };
  });

  // Cancel processing
  ipcMain.handle('cancel-processing', async () => {
    // Cancel any active video processing
    if (activeVideoProcessing) {
      activeVideoProcessing.cancelled = true;
    }
    // Cancel any active transcription
    if (activeTranscription?.process) {
      activeTranscription.process.kill('SIGTERM');
      activeTranscription = null;
    }
    // Cancel any active Ollama analysis
    cancelOllamaAnalysis();
    return { success: true };
  });

  // Get settings
  ipcMain.handle('get-settings', async () => {
    return {
      analysisMethod: settingsStore.get('analysisMethod'),
      ollamaModel: settingsStore.get('ollamaModel'),
      transcriptionMethod: settingsStore.get('transcriptionMethod'),
      whisperModel: settingsStore.get('whisperModel'),
      preferBuiltInWhisper: settingsStore.get('preferBuiltInWhisper'),
      frameCount: settingsStore.get('frameCount'),
      renameFiles: settingsStore.get('renameFiles'),
    };
  });

  // Save settings
  ipcMain.handle('save-settings', async (_event, settings: Record<string, unknown>) => {
    try {
      if (typeof settings.frameCount === 'number') {
        settingsStore.set('frameCount', settings.frameCount);
      }
      if (typeof settings.renameFiles === 'boolean') {
        settingsStore.set('renameFiles', settings.renameFiles);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: `Failed to save settings: ${err}` };
    }
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
    return {
      preferBuiltIn: settingsStore.get('preferBuiltInWhisper'),
      selectedModel: settingsStore.get('whisperModel'),
    };
  });

  ipcMain.handle('save-whisper-settings', async (_event, settings: WhisperSettings) => {
    try {
      settingsStore.set('preferBuiltInWhisper', settings.preferBuiltIn);
      settingsStore.set('whisperModel', settings.selectedModel);
      return { success: true };
    } catch (err) {
      return { success: false, error: `Failed to save whisper settings: ${err}` };
    }
  });

  // Ollama/LLaVA management
  // Get system memory info
  ipcMain.handle('get-system-memory', async () => {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const totalGb = Math.round(totalBytes / (1024 * 1024 * 1024));
    const freeGb = Math.round(freeBytes / (1024 * 1024 * 1024));

    // Recommend model based on available RAM
    // Models need RAM headroom (approximately 2GB for OS + other processes)
    const availableForModels = totalGb - 2;
    let recommendedModel: string | null = null;

    if (availableForModels >= 32) {
      recommendedModel = 'llava:34b';
    } else if (availableForModels >= 16) {
      recommendedModel = 'llava:13b';
    } else if (availableForModels >= 8) {
      recommendedModel = 'llava:7b';
    }

    return {
      totalGb,
      freeGb,
      recommendedModel,
    };
  });

  ipcMain.handle('get-ollama-status', async () => {
    const status = await checkOllama();
    const pulledModels = status.running ? await getOllamaPulledModels() : [];

    // Check which LLaVA models are pulled
    const llavaModelStatus = LLAVA_MODELS.map(model => ({
      ...model,
      isPulled: pulledModels.some(m => m === model.tag || m.startsWith(model.name + ':')),
    }));

    return {
      installed: status.installed,
      running: status.running,
      version: status.version,
      pulledModels,
      llavaModels: llavaModelStatus,
    };
  });

  ipcMain.handle('start-ollama', async () => {
    return await startOllama();
  });

  ipcMain.handle('get-llava-models', async () => {
    const ollamaStatus = await checkOllama();
    if (!ollamaStatus.running) {
      return {
        available: false,
        error: 'Ollama is not running',
        models: LLAVA_MODELS.map(m => ({ ...m, isPulled: false })),
      };
    }

    const pulledModels = await getOllamaPulledModels();

    return {
      available: true,
      models: LLAVA_MODELS.map(model => ({
        ...model,
        isPulled: pulledModels.some(m => m === model.tag || m.startsWith(model.name + ':')),
      })),
    };
  });

  ipcMain.handle('pull-llava-model', async (_event, modelTag: string) => {
    const mainWindow = getMainWindow();

    // Ensure Ollama is running
    const ollamaStatus = await checkOllama();
    if (!ollamaStatus.running) {
      const startResult = await startOllama();
      if (!startResult.success) {
        return { success: false, error: startResult.error };
      }
    }

    return new Promise((resolve) => {
      const pullProcess = spawn('ollama', ['pull', modelTag]);

      pullProcess.stdout.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        mainWindow?.webContents.send('ollama:pull-progress', {
          modelTag,
          message,
          status: 'pulling',
        });
      });

      pullProcess.stderr.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        // Ollama outputs progress to stderr
        mainWindow?.webContents.send('ollama:pull-progress', {
          modelTag,
          message,
          status: 'pulling',
        });
      });

      pullProcess.on('close', (code) => {
        if (code === 0) {
          mainWindow?.webContents.send('ollama:pull-complete', {
            success: true,
            modelTag,
          });
          resolve({ success: true });
        } else {
          mainWindow?.webContents.send('ollama:pull-complete', {
            success: false,
            modelTag,
            error: `Pull failed with exit code ${code}`,
          });
          resolve({ success: false, error: `Pull failed with exit code ${code}` });
        }
      });

      pullProcess.on('error', (err) => {
        mainWindow?.webContents.send('ollama:pull-complete', {
          success: false,
          modelTag,
          error: err.message,
        });
        resolve({ success: false, error: err.message });
      });
    });
  });

  ipcMain.handle('remove-llava-model', async (_event, modelTag: string) => {
    try {
      await execAsync(`ollama rm ${modelTag}`);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Failed to remove model: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  });

  // Ollama analysis
  ipcMain.handle('analyze-with-ollama', async (
    _event,
    options: {
      imagePaths: string[];
      videoName: string;
      transcript: string | null;
      modelTag: string;
    }
  ) => {
    const { imagePaths, videoName, transcript, modelTag } = options;
    return await analyzeWithOllama(imagePaths, videoName, transcript, modelTag);
  });

  ipcMain.handle('cancel-ollama-analysis', async () => {
    const cancelled = cancelOllamaAnalysis();
    return { success: cancelled };
  });

  // Analysis settings
  ipcMain.handle('get-analysis-settings', async () => {
    return {
      method: settingsStore.get('analysisMethod'),
      ollamaModel: settingsStore.get('ollamaModel'),
    };
  });

  ipcMain.handle('save-analysis-settings', async (_event, settings: {
    method: 'claude' | 'ollama';
    ollamaModel: string;
  }) => {
    try {
      settingsStore.set('analysisMethod', settings.method);
      settingsStore.set('ollamaModel', settings.ollamaModel);
      return { success: true };
    } catch (err) {
      return { success: false, error: `Failed to save analysis settings: ${err}` };
    }
  });
}
