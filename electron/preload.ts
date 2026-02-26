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

  // Video operations
  getVideoDetails: (videoId: number): Promise<unknown> => ipcRenderer.invoke('get-video-details', videoId),
  processVideo: (videoId: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('process-video', videoId),
  processBatch: (videoIds: number[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('process-batch', videoIds),
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
  getWhisperModels: (): Promise<unknown[]> => ipcRenderer.invoke('get-whisper-models'),
  downloadWhisperModel: (modelName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('download-whisper-model', modelName),
  deleteWhisperModel: (modelName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('delete-whisper-model', modelName),

  // Ollama/LLaVA
  getOllamaStatus: (): Promise<{ installed: boolean; running: boolean }> =>
    ipcRenderer.invoke('get-ollama-status'),
  getLlavaModels: (): Promise<unknown[]> => ipcRenderer.invoke('get-llava-models'),
  pullLlavaModel: (variant: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('pull-llava-model', variant),
  removeLlavaModel: (variant: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('remove-llava-model', variant),

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
  onProcessingError: (callback: (error: { videoId: number; error: string }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, error: { videoId: number; error: string }) => callback(error);
    ipcRenderer.on('processing:error', handler);
    return () => ipcRenderer.removeListener('processing:error', handler);
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for the renderer process
export type ElectronAPI = typeof electronAPI;
