/**
 * MainPanel - main content area: the selected video's details with the
 * processing progress overlay, or the welcome screen. Extracted from App.
 */

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, XCircle } from 'lucide-react';
import { VideoDetails } from '@/components/video-details';
import type { VideoItem } from '@/components/video-list';
import { getStepLabel, type ProcessingProgress } from '@/hooks/use-batch-processor';

interface MainPanelProps {
  selectedVideo: VideoItem | null;
  currentFolder: string | null;
  isAnalyzing: boolean;
  analyzingVideoPath: string | null;
  processingProgress: ProcessingProgress | null;
  onAnalyze: (video: VideoItem) => void;
  onCancelClick: () => void;
}

export function MainPanel({
  selectedVideo,
  currentFolder,
  isAnalyzing,
  analyzingVideoPath,
  processingProgress,
  onAnalyze,
  onCancelClick,
}: MainPanelProps): JSX.Element {
  return (
    <main className="flex-1 overflow-hidden">
      {selectedVideo && currentFolder ? (
        <div className="flex flex-col h-full">
          {/* Progress bar overlay when analyzing */}
          {isAnalyzing && analyzingVideoPath === selectedVideo.path && processingProgress && (
            <div className="px-6 py-3 bg-card border-b border-border space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="font-medium">
                    {getStepLabel(processingProgress.step)}
                  </span>
                  <span className="text-muted-foreground">
                    (Step {processingProgress.stepNumber} of {processingProgress.totalSteps})
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-primary">
                    {processingProgress.percentage}%
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onCancelClick}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
              <Progress value={processingProgress.percentage} />
            </div>
          )}
          <VideoDetails
            video={selectedVideo}
            currentFolder={currentFolder}
            onAnalyze={onAnalyze}
            isAnalyzing={isAnalyzing && analyzingVideoPath === selectedVideo.path}
            className="flex-1 min-h-0"
          />
        </div>
      ) : (
        <div className="p-6 overflow-auto scrollbar-macos h-full">
          <div className="max-w-3xl space-y-6">
            {/* Welcome message */}
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Welcome to AI Video Cataloger</h2>
              <p className="text-muted-foreground">
                Select a folder containing videos to get started. The app will analyze your videos
                using AI to generate summaries, transcriptions, and smart file names.
              </p>
            </div>

            {/* Instructions */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h3 className="font-medium">Getting Started</h3>
              <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                <li>Click "Open Folder" to select a folder with video files</li>
                <li>The sidebar will show all detected videos</li>
                <li>Select a video to view details and analysis results</li>
                <li>Click "Analyze" to process individual videos</li>
                <li>Terminal output shows real-time progress</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
