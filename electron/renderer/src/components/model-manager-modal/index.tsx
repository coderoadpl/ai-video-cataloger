/**
 * ModelManagerModal - manage Whisper models (list, download, activate,
 * delete) via the CLI. Presentation split into ModelRow and
 * DeleteModelDialog subcomponents.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, HardDrive } from 'lucide-react';
import { useCliCommand } from '@/hooks/use-cli-command';
import { LocalAiSection } from '@/components/local-ai/local-ai-section';
import { MODEL_SIZES, formatBytes, type WhisperModelInfo, type DownloadProgress } from './types';
import { ModelRow } from './model-row';
import { DeleteModelDialog } from './delete-model-dialog';

interface DeleteConfirmation {
  open: boolean;
  modelName: string | null;
}

interface ModelManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogMessage?: (message: string, type?: 'info' | 'success' | 'error') => void;
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
              Manage Whisper transcription models and local AI analysis models.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Whisper transcription models */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Whisper transcription models</h3>
              {isLoading ? (
                <div className="py-4 flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Loading models...</span>
                </div>
              ) : error ? (
                <div className="py-4 text-center">
                  <p className="text-destructive text-sm">{error}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={loadModels}>
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                    <HardDrive className="h-4 w-4" />
                    <span>Disk space used: {formatBytes(totalDiskSpace)}</span>
                  </div>
                  <div className="space-y-2">
                    {models.map((model) => (
                      <ModelRow
                        key={model.name}
                        model={model}
                        isSettingActive={isSettingActive}
                        isDeleting={isDeleting}
                        downloadProgress={downloadProgress}
                        isOperationInProgress={isOperationInProgress}
                        onSetActive={handleSetActive}
                        onDownload={handleDownloadClick}
                        onDelete={handleDeleteClick}
                      />
                    ))}
                  </div>
                  {downloadProgress && (
                    <div className="text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                      <p>
                        Downloading {downloadProgress.modelName}:{' '}
                        {formatBytes(downloadProgress.downloadedBytes)} /{' '}
                        {formatBytes(downloadProgress.totalBytes)} ({downloadProgress.speedFormatted})
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Local AI models - independent of the whisper section above */}
            <div className="border-t pt-4">
              <LocalAiSection runCli={runCli} active={open} onLogMessage={onLogMessage} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <DeleteModelDialog
        open={deleteConfirmation.open}
        modelName={deleteConfirmation.modelName}
        onClose={() => setDeleteConfirmation({ open: false, modelName: null })}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
