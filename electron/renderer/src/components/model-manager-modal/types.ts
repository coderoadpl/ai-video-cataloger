/**
 * Shared types for the Model Manager modal and its subcomponents.
 */

// Model info type matching the CLI models service
export interface WhisperModelInfo {
  name: string;
  size: string;
  downloaded: boolean;
  active: boolean;
}

export interface DownloadProgress {
  modelName: string;
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
  speedFormatted: string;
}

// Model definitions with sizes in bytes (matching CLI models.ts)
export const MODEL_SIZES: Record<string, number> = {
  tiny: 75_000_000,
  base: 142_000_000,
  small: 466_000_000,
  medium: 1_500_000_000,
  'large-v3': 3_100_000_000,
};

// Format bytes to human-readable string
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
