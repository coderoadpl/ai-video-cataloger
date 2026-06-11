import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Download, Trash2, CheckCircle2, HardDrive, AlertTriangle } from 'lucide-react';
import { useCliCommand } from '@/hooks/use-cli-command';

// Model info type matching the CLI models service
interface WhisperModelInfo {
  name: string;
  size: string;
  downloaded: boolean;
  active: boolean;
}

// Model definitions with sizes in bytes (matching CLI models.ts)
const MODEL_SIZES: Record<string, number> = {
  tiny: 75_000_000,
  base: 142_000_000,
  small: 466_000_000,
  medium: 1_500_000_000,
  'large-v3': 3_100_000_000,
};

interface DownloadProgress {
  modelName: string;
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
  speedFormatted: string;
}

interface DeleteConfirmation {
  open: boolean;
  modelName: string | null;
}

interface ModelManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogMessage?: (message: string, type?: 'info' | 'success' | 'error') => void;
}

// Format bytes to human-readable string
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ModelManagerModal({
  open,
  onOpenChange,
  onLogMessage,
}: ModelManagerModalProps): JSX.Element {
  const runCli = useCliCommand();
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation>({
    open: false,
    modelName: null,
  });

  // Calculate total disk space used by downloaded models
  const totalDiskSpace = models
    .filter((m) => m.downloaded)
    .reduce((total, m) => total + (MODEL_SIZES[m.name] || 0), 0);

  // Log message helper
  const log = useCallback(
    (message: string, type: 'info' | 'success' | 'error' = 'info') => {
      onLogMessage?.(message, type);
    },
    [onLogMessage]
  );

  // Load model list from CLI
  const loadModels = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    log('Loading Whisper models...', 'info');

    try {
      const { code, events } = await runCli(['models', 'list', '--json'], {
        onJson: (event) => {
          if (event.type === 'error') {
            setError(event.error || 'Failed to load models');
            log(`Error: ${event.error || 'Failed to load models'}`, 'error');
          }
        },
        onLine: (line, source) => {
          if (source === 'stdout') {
            log(line, 'info');
          }
        },
      });

      const hasError = events.some((event) => event.type === 'error');
      const completed = events.find((event) => event.type === 'completed' && event.data);
      const modelList = (completed?.data?.models as WhisperModelInfo[] | undefined) ?? [];

      if (!hasError && code === 0 && modelList.length > 0) {
        setModels(modelList);
        log(`Found ${modelList.length} Whisper model(s)`, 'success');
      } else if (!hasError && modelList.length === 0) {
        setError('No models found');
        log('No models found', 'error');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError('Failed to run models command');
      log(`Failed to run models command: ${message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [log, runCli]);

  // Load models when modal opens
  useEffect(() => {
    if (open) {
      loadModels();
    }
  }, [open, loadModels]);

  // Download a model
  const downloadModel = useCallback(
    async (modelName: string): Promise<boolean> => {
      log(`Downloading model: ${modelName}...`, 'info');
      setDownloadProgress({
        modelName,
        percentage: 0,
        downloadedBytes: 0,
        totalBytes: MODEL_SIZES[modelName] || 0,
        speedFormatted: '0 B/s',
      });

      try {
        const { code, events } = await runCli(['models', 'download', modelName, '--json'], {
          onJson: (event) => {
            if (event.type === 'progress' && event.step === 'downloading') {
              const data = event.data as
                | {
                    downloadedBytes?: number;
                    totalBytes?: number;
                    speedFormatted?: string;
                  }
                | undefined;
              setDownloadProgress({
                modelName,
                percentage: event.percentage || 0,
                downloadedBytes: data?.downloadedBytes || 0,
                totalBytes: data?.totalBytes || MODEL_SIZES[modelName] || 0,
                speedFormatted: data?.speedFormatted || '0 B/s',
              });
            } else if (event.type === 'completed') {
              log(`Model ${modelName} downloaded successfully`, 'success');
            } else if (event.type === 'error') {
              log(`Failed to download model: ${event.error}`, 'error');
            }
          },
          onLine: (line, source) => {
            if (source === 'stdout') {
              log(line, 'info');
            }
          },
        });

        setDownloadProgress(null);

        const success = events.some((event) => event.type === 'completed');
        if (code === 0 && success) {
          // Refresh model list
          await loadModels();
          return true;
        }
        return false;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setDownloadProgress(null);
        log(`Failed to start download for ${modelName}: ${message}`, 'error');
        return false;
      }
    },
    [log, loadModels, runCli]
  );

  // Set a model as active
  const setActiveModel = useCallback(
    async (modelName: string): Promise<boolean> => {
      log(`Setting active model: ${modelName}...`, 'info');

      try {
        const { code, events } = await runCli(['models', 'use', modelName, '--json'], {
          onJson: (event) => {
            if (event.type === 'completed') {
              log(`Model ${modelName} is now active`, 'success');
            } else if (event.type === 'error') {
              log(`Failed to set active model: ${event.error}`, 'error');
            }
          },
          onLine: (line, source) => {
            if (source === 'stdout') {
              log(line, 'info');
            }
          },
        });

        const success = events.some((event) => event.type === 'completed');
        if (code === 0 && success) {
          // Refresh model list to show new active status
          await loadModels();
          return true;
        }
        return false;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Failed to set active model ${modelName}: ${message}`, 'error');
        return false;
      }
    },
    [log, loadModels, runCli]
  );

  // Delete a model
  const deleteModel = useCallback(
    async (modelName: string): Promise<boolean> => {
      log(`Deleting model: ${modelName}...`, 'info');
      setIsDeleting(modelName);

      try {
        // Run delete command with --force
        const { code, events } = await runCli(['models', 'delete', modelName, '--force', '--json'], {
          onJson: (event) => {
            if (event.type === 'completed') {
              log(`Model ${modelName} deleted successfully`, 'success');
            } else if (event.type === 'error') {
              log(`Failed to delete model: ${event.error}`, 'error');
            }
          },
          onLine: (line, source) => {
            if (source === 'stdout') {
              log(line, 'info');
            }
          },
        });

        setIsDeleting(null);

        const success = events.some((event) => event.type === 'completed');
        if (code === 0 && success) {
          // Refresh model list
          await loadModels();
          return true;
        }
        return false;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setIsDeleting(null);
        log(`Failed to delete model ${modelName}: ${message}`, 'error');
        return false;
      }
    },
    [log, loadModels, runCli]
  );

  // Handle delete button click - show confirmation
  const handleDeleteClick = useCallback((modelName: string) => {
    setDeleteConfirmation({ open: true, modelName });
  }, []);

  // Handle delete confirmation
  const handleConfirmDelete = useCallback(async () => {
    if (deleteConfirmation.modelName) {
      await deleteModel(deleteConfirmation.modelName);
    }
    setDeleteConfirmation({ open: false, modelName: null });
  }, [deleteConfirmation.modelName, deleteModel]);

  // Handle download button click
  const handleDownloadClick = useCallback(
    async (modelName: string) => {
      await downloadModel(modelName);
    },
    [downloadModel]
  );

  // Track if setting active model
  const [isSettingActive, setIsSettingActive] = useState<string | null>(null);

  // Handle setting active model
  const handleSetActive = useCallback(
    async (modelName: string) => {
      if (!models.find((m) => m.name === modelName)?.downloaded) return;
      if (models.find((m) => m.name === modelName)?.active) return; // Already active

      setIsSettingActive(modelName);
      await setActiveModel(modelName);
      setIsSettingActive(null);
    },
    [models, setActiveModel]
  );

  // Check if any operation is in progress
  const isOperationInProgress = downloadProgress !== null || isDeleting !== null || isSettingActive !== null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>Model Manager</DialogTitle>
            <DialogDescription>
              Manage Whisper models for local audio transcription. Larger models are more accurate
              but require more memory and take longer to process.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="py-8 flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading models...</span>
            </div>
          ) : error ? (
            <div className="py-6 text-center">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={loadModels}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Disk space summary */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                <HardDrive className="h-4 w-4" />
                <span>Disk space used: {formatBytes(totalDiskSpace)}</span>
              </div>

              {/* Model list */}
              <div className="space-y-2">
                {models.map((model) => (
                  <div
                    key={model.name}
                    className={`flex items-center justify-between p-3 rounded-lg border border-border bg-card transition-colors ${
                      model.downloaded && !model.active && !isOperationInProgress
                        ? 'hover:bg-muted/30 cursor-pointer'
                        : model.active
                        ? 'border-primary/50 bg-primary/5'
                        : ''
                    }`}
                    onClick={() => {
                      if (model.downloaded && !model.active && !isOperationInProgress) {
                        handleSetActive(model.name);
                      }
                    }}
                    role={model.downloaded && !model.active ? 'button' : undefined}
                    tabIndex={model.downloaded && !model.active ? 0 : undefined}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {/* Status indicator */}
                      {isSettingActive === model.name ? (
                        <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
                      ) : model.downloaded ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
                      )}

                      {/* Model info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium capitalize">{model.name}</span>
                          {model.active && (
                            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {model.size} • {model.downloaded ? (model.active ? 'Downloaded' : 'Click to activate') : 'Not downloaded'}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Download progress */}
                      {downloadProgress?.modelName === model.name && (
                        <div className="flex items-center gap-2 w-40">
                          <Progress value={downloadProgress.percentage} className="h-2 flex-1" />
                          <span className="text-xs text-muted-foreground w-10 text-right">
                            {downloadProgress.percentage}%
                          </span>
                        </div>
                      )}

                      {/* Download button */}
                      {!model.downloaded && downloadProgress?.modelName !== model.name && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadClick(model.name)}
                          disabled={isOperationInProgress}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </Button>
                      )}

                      {/* Delete button */}
                      {model.downloaded && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(model.name)}
                          disabled={isOperationInProgress}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          {isDeleting === model.name ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Download progress details */}
              {downloadProgress && (
                <div className="text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                  <p>
                    Downloading {downloadProgress.modelName}:{' '}
                    {formatBytes(downloadProgress.downloadedBytes)} /{' '}
                    {formatBytes(downloadProgress.totalBytes)} ({downloadProgress.speedFormatted})
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteConfirmation.open}
        onOpenChange={(open) => !open && setDeleteConfirmation({ open: false, modelName: null })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Delete Model?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the "{deleteConfirmation.modelName}" model? You will
              need to download it again if you want to use it for transcription.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Model
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
