/**
 * Preload Script
 * Exposes a limited API to the renderer process
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Define the API exposed to the renderer
const electronAPI = {
  // Folder operations
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  scanFolder: (folderPath: string): Promise<unknown[]> => ipcRenderer.invoke('scan-folder', folderPath),
  getRecentFolders: (): Promise<string[]> => ipcRenderer.invoke('get-recent-folders'),
  getLastFolder: (): Promise<string | null> => ipcRenderer.invoke('get-last-folder'),
  setCurrentFolder: (folderPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-current-folder', folderPath),

  // Video operations
  getVideoDetails: (videoId: number): Promise<unknown> => ipcRenderer.invoke('get-video-details', videoId),
  processVideo: (videoPath: string): Promise<{ success: boolean; error?: string; errorStep?: string }> =>
    ipcRenderer.invoke('process-video', videoPath),
  processBatch: (videoPaths: string[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('process-batch', videoPaths),
  cancelProcessing: (): Promise<{ success: boolean }> => ipcRenderer.invoke('cancel-processing'),

  // Settings
  getSettings: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Record<string, unknown>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('save-settings', settings),

  // File system
  revealInFinder: (filePath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('reveal-in-finder', filePath),
  getAppPaths: (): Promise<{ userData: string; temp: string; home: string }> =>
    ipcRenderer.invoke('get-app-paths'),

  // Prerequisites
  checkPrerequisites: (): Promise<{
    ffmpeg: { available: boolean; version: string; bundled: boolean; path: string };
    ffprobe: { available: boolean; path: string };
    whisper: { available: boolean; version: string | null; path: string | null; type: 'whisper.cpp' | 'whisper' | null };
    claude: { available: boolean };
    ollama: { installed: boolean; running: boolean; version: string | null };
    openaiKey: { available: boolean };
    analysisMethods: string[];
    transcriptionMethods: string[];
  }> => ipcRenderer.invoke('check-prerequisites'),

  // Whisper models
  getWhisperModels: (): Promise<{
    models: { name: string; filename: string; path: string; sizeBytes: number }[];
    modelsPath: string;
  }> => ipcRenderer.invoke('get-whisper-models'),
  downloadWhisperModel: (modelName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('download-whisper-model', modelName),
  cancelWhisperModelDownload: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('cancel-whisper-model-download'),
  deleteWhisperModel: (modelName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('delete-whisper-model', modelName),

  // Model download events
  onModelDownloadProgress: (
    callback: (progress: { modelName: string; bytesDownloaded: number; totalBytes: number; speed: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: { modelName: string; bytesDownloaded: number; totalBytes: number; speed: string }
    ) => callback(progress);
    ipcRenderer.on('model:download-progress', handler);
    return () => ipcRenderer.removeListener('model:download-progress', handler);
  },
  onModelDownloadComplete: (
    callback: (result: { success: boolean; modelName: string; error?: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      result: { success: boolean; modelName: string; error?: string }
    ) => callback(result);
    ipcRenderer.on('model:download-complete', handler);
    return () => ipcRenderer.removeListener('model:download-complete', handler);
  },

  // Whisper.cpp transcription
  getWhisperCppStatus: (): Promise<{
    bundled: { available: boolean; path: string; version: string };
    system: {
      whisperCpp: { available: boolean; path: string | null; version: string | null };
      whisperCli: { available: boolean; path: string | null; version: string | null };
    };
  }> => ipcRenderer.invoke('get-whisper-cpp-status'),

  transcribeAudio: (options: {
    audioPath: string;
    modelName: string;
    outputDir: string;
    preferBuiltIn: boolean;
  }): Promise<{
    success: boolean;
    transcript?: string;
    outputPath?: string;
    error?: string;
    method?: string;
  }> => ipcRenderer.invoke('transcribe-audio', options),

  cancelTranscription: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('cancel-transcription'),

  getWhisperSettings: (): Promise<{
    preferBuiltIn: boolean;
    selectedModel: string;
  }> => ipcRenderer.invoke('get-whisper-settings'),

  saveWhisperSettings: (settings: {
    preferBuiltIn: boolean;
    selectedModel: string;
  }): Promise<{ success: boolean }> => ipcRenderer.invoke('save-whisper-settings', settings),

  // Transcription progress events
  onTranscriptionProgress: (
    callback: (progress: { audioPath: string; status: string; message: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: { audioPath: string; status: string; message: string }
    ) => callback(progress);
    ipcRenderer.on('transcription:progress', handler);
    return () => ipcRenderer.removeListener('transcription:progress', handler);
  },

  // System information
  getSystemMemory: (): Promise<{
    totalGb: number;
    freeGb: number;
    recommendedModel: string | null;
  }> => ipcRenderer.invoke('get-system-memory'),

  // Ollama/LLaVA
  getOllamaStatus: (): Promise<{
    installed: boolean;
    running: boolean;
    version: string | null;
    pulledModels: string[];
    llavaModels: Array<{
      name: string;
      tag: string;
      description: string;
      sizeGb: number;
      minRamGb: number;
      isPulled: boolean;
    }>;
  }> => ipcRenderer.invoke('get-ollama-status'),

  startOllama: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('start-ollama'),

  getLlavaModels: (): Promise<{
    available: boolean;
    error?: string;
    models: Array<{
      name: string;
      tag: string;
      description: string;
      sizeGb: number;
      minRamGb: number;
      isPulled: boolean;
    }>;
  }> => ipcRenderer.invoke('get-llava-models'),

  pullLlavaModel: (modelTag: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('pull-llava-model', modelTag),

  removeLlavaModel: (modelTag: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('remove-llava-model', modelTag),

  // Ollama analysis
  analyzeWithOllama: (options: {
    imagePaths: string[];
    videoName: string;
    transcript: string | null;
    modelTag: string;
  }): Promise<{
    success: boolean;
    description?: string;
    suggestedFilename?: string;
    fullResponse?: string;
    error?: string;
  }> => ipcRenderer.invoke('analyze-with-ollama', options),

  cancelOllamaAnalysis: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('cancel-ollama-analysis'),

  // Ollama events
  onOllamaPullProgress: (
    callback: (progress: { modelTag: string; message: string; status: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: { modelTag: string; message: string; status: string }
    ) => callback(progress);
    ipcRenderer.on('ollama:pull-progress', handler);
    return () => ipcRenderer.removeListener('ollama:pull-progress', handler);
  },

  onOllamaPullComplete: (
    callback: (result: { success: boolean; modelTag: string; error?: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      result: { success: boolean; modelTag: string; error?: string }
    ) => callback(result);
    ipcRenderer.on('ollama:pull-complete', handler);
    return () => ipcRenderer.removeListener('ollama:pull-complete', handler);
  },

  onOllamaAnalysisProgress: (
    callback: (progress: { status: string; message: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: { status: string; message: string }
    ) => callback(progress);
    ipcRenderer.on('ollama:analysis-progress', handler);
    return () => ipcRenderer.removeListener('ollama:analysis-progress', handler);
  },

  // Analysis settings
  getAnalysisSettings: (): Promise<{
    method: 'claude' | 'ollama';
    ollamaModel: string;
  }> => ipcRenderer.invoke('get-analysis-settings'),

  saveAnalysisSettings: (settings: {
    method: 'claude' | 'ollama';
    ollamaModel: string;
  }): Promise<{ success: boolean }> => ipcRenderer.invoke('save-analysis-settings', settings),

  // Event listeners from main process
  onMenuOpenSettings: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:open-settings', handler);
    return () => ipcRenderer.removeListener('menu:open-settings', handler);
  },
  onMenuOpenFolder: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:open-folder', handler);
    return () => ipcRenderer.removeListener('menu:open-folder', handler);
  },
  onMenuRefresh: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:refresh', handler);
    return () => ipcRenderer.removeListener('menu:refresh', handler);
  },
  onMenuOpenPrerequisites: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:open-prerequisites', handler);
    return () => ipcRenderer.removeListener('menu:open-prerequisites', handler);
  },
  onMenuOpenModelManager: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:open-model-manager', handler);
    return () => ipcRenderer.removeListener('menu:open-model-manager', handler);
  },
  onMenuRunSetupWizard: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:run-setup-wizard', handler);
    return () => ipcRenderer.removeListener('menu:run-setup-wizard', handler);
  },

  // Progress events
  onProcessingProgress: (
    callback: (progress: { videoId: number; step: string; percent: number }) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, progress: { videoId: number; step: string; percent: number }) =>
      callback(progress);
    ipcRenderer.on('processing:progress', handler);
    return () => ipcRenderer.removeListener('processing:progress', handler);
  },
  onProcessingComplete: (callback: (result: { videoId: number; success: boolean }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, result: { videoId: number; success: boolean }) => callback(result);
    ipcRenderer.on('processing:complete', handler);
    return () => ipcRenderer.removeListener('processing:complete', handler);
  },
  onProcessingError: (callback: (error: { videoId: number; error: string; step?: string }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, error: { videoId: number; error: string; step?: string }) => callback(error);
    ipcRenderer.on('processing:error', handler);
    return () => ipcRenderer.removeListener('processing:error', handler);
  },

  // Batch processing events
  onBatchStart: (
    callback: (info: { totalVideos: number }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      info: { totalVideos: number }
    ) => callback(info);
    ipcRenderer.on('batch:start', handler);
    return () => ipcRenderer.removeListener('batch:start', handler);
  },

  onBatchProgress: (
    callback: (progress: {
      currentVideo: number;
      totalVideos: number;
      videoPath: string;
      videoId: number;
      videoName: string;
    }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: {
        currentVideo: number;
        totalVideos: number;
        videoPath: string;
        videoId: number;
        videoName: string;
      }
    ) => callback(progress);
    ipcRenderer.on('batch:progress', handler);
    return () => ipcRenderer.removeListener('batch:progress', handler);
  },

  onBatchComplete: (
    callback: (result: {
      success: boolean;
      successCount: number;
      failureCount: number;
      totalVideos: number;
      cancelled: boolean;
    }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      result: {
        success: boolean;
        successCount: number;
        failureCount: number;
        totalVideos: number;
        cancelled: boolean;
      }
    ) => callback(result);
    ipcRenderer.on('batch:complete', handler);
    return () => ipcRenderer.removeListener('batch:complete', handler);
  },

  onBatchCancelled: (
    callback: (info: {
      processedCount: number;
      totalVideos: number;
      successCount: number;
      failureCount: number;
    }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      info: {
        processedCount: number;
        totalVideos: number;
        successCount: number;
        failureCount: number;
      }
    ) => callback(info);
    ipcRenderer.on('batch:cancelled', handler);
    return () => ipcRenderer.removeListener('batch:cancelled', handler);
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for the renderer process
export type ElectronAPI = typeof electronAPI;
