/**
 * BatchToolbar - "Analyze All" button and the batch progress indicator with
 * its Stop button, extracted from the App sidebar header.
 */

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Play, XCircle } from 'lucide-react';
import type { BatchProgress } from '@/hooks/use-batch-processor';

interface BatchToolbarProps {
  pendingVideosCount: number;
  isBatchProcessing: boolean;
  isAnalyzing: boolean;
  batchProgress: BatchProgress | null;
  onBatchAnalyze: () => void;
  onBatchCancel: () => void;
}

export function BatchToolbar({
  pendingVideosCount,
  isBatchProcessing,
  isAnalyzing,
  batchProgress,
  onBatchAnalyze,
  onBatchCancel,
}: BatchToolbarProps): JSX.Element {
  return (
    <>
      {/* Analyze All button */}
      {pendingVideosCount > 0 && !isBatchProcessing && !isAnalyzing && (
        <Button
          size="sm"
          className="w-full"
          onClick={onBatchAnalyze}
        >
          <Play className="h-4 w-4 mr-2" />
          Analyze All ({pendingVideosCount})
        </Button>
      )}
      {/* Batch progress indicator in sidebar */}
      {isBatchProcessing && batchProgress && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Processing {batchProgress.currentIndex} of {batchProgress.totalCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-destructive hover:text-destructive"
              onClick={onBatchCancel}
            >
              <XCircle className="h-3 w-3 mr-1" />
              Stop
            </Button>
          </div>
          <Progress value={(batchProgress.currentIndex / batchProgress.totalCount) * 100} className="h-1.5" />
          <p className="text-xs text-muted-foreground truncate">
            {batchProgress.currentVideo.filename}
          </p>
        </div>
      )}
    </>
  );
}
