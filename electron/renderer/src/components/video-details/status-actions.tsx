/**
 * StatusActions - the per-status action cards of VideoDetails: Analyze
 * (pending), Continue (incomplete) and Retry (error). Extracted from
 * video-details.tsx.
 */

import { Button } from '@/components/ui/button';
import { AlertCircle, PlayCircle, Loader2 } from 'lucide-react';
import type { VideoItem } from '@/components/video-list';

interface StatusActionsProps {
  video: VideoItem;
  onAnalyze?: (video: VideoItem) => void;
  isAnalyzing: boolean;
}

export function StatusActions({ video, onAnalyze, isAnalyzing }: StatusActionsProps): JSX.Element {
  const isPending = video.status === 'pending' || video.status === 'not_tracked';
  const isIncomplete = ['frames_extracted', 'audio_extracted', 'transcribed', 'analyzed'].includes(video.status);
  const isError = video.status === 'error';

  return (
    <>
      {/* Pending state: Show Analyze button */}
      {isPending && onAnalyze && (
        <div className="space-y-4">
          <Button
            data-testid="analyze-button"
            onClick={() => onAnalyze(video)}
            disabled={isAnalyzing}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4 mr-2" />
                Analyze Video
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            This will extract frames, transcribe audio, and generate a summary using AI.
          </p>
        </div>
      )}

      {/* Incomplete state: Show Continue button */}
      {isIncomplete && onAnalyze && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-start gap-2 mb-3">
            <AlertCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="font-medium text-orange-900">Processing Incomplete</h3>
              <p className="text-sm text-orange-700">
                A previous processing attempt was interrupted. Click the button below to restart.
              </p>
            </div>
          </div>
          <Button
            data-testid="analyze-button"
            onClick={() => onAnalyze(video)}
            disabled={isAnalyzing}
            className="w-full"
            variant="outline"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4 mr-2" />
                Continue Analysis
              </>
            )}
          </Button>
        </div>
      )}

      {/* Error state: Show error message */}
      {isError && video.errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="font-medium text-red-900">Processing Failed</h3>
              <p className="text-sm text-red-700">{video.errorMessage}</p>
            </div>
          </div>
          {onAnalyze && (
            <Button
              data-testid="analyze-button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => onAnalyze(video)}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Retrying...
                </>
              ) : (
                'Retry Analysis'
              )}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
