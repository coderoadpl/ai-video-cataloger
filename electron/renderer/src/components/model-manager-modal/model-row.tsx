/**
 * ModelRow - a single Whisper model row in the Model Manager (status
 * indicator, info, download progress and action buttons). Extracted from
 * model-manager-modal.tsx.
 */

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, Download, Trash2, CheckCircle2 } from 'lucide-react';
import type { WhisperModelInfo, DownloadProgress } from './types';

interface ModelRowProps {
  model: WhisperModelInfo;
  isSettingActive: string | null;
  isDeleting: string | null;
  downloadProgress: DownloadProgress | null;
  isOperationInProgress: boolean;
  onSetActive: (modelName: string) => void;
  onDownload: (modelName: string) => void;
  onDelete: (modelName: string) => void;
}

export function ModelRow({
  model,
  isSettingActive,
  isDeleting,
  downloadProgress,
  isOperationInProgress,
  onSetActive,
  onDownload,
  onDelete,
}: ModelRowProps): JSX.Element {
  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border border-border bg-card transition-colors ${
        model.downloaded && !model.active && !isOperationInProgress
          ? 'hover:bg-muted/30 cursor-pointer'
          : model.active
          ? 'border-primary/50 bg-primary/5'
          : ''
      }`}
      onClick={() => {
        if (model.downloaded && !model.active && !isOperationInProgress) {
          onSetActive(model.name);
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
            onClick={() => onDownload(model.name)}
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
            onClick={() => onDelete(model.name)}
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
  );
}
