/**
 * ArtifactsSection - summary, extracted frames, transcript and full-analysis
 * cards of VideoDetails (incl. the FrameGallery). Extracted from
 * video-details.tsx.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { mediaUrl } from '@/lib/media-url';
import { FileText, Image } from 'lucide-react';
import type { VideoItem } from '@/components/video-list';

/**
 * FrameGallery component
 */
function FrameGallery({
  framePaths,
}: {
  framePaths: string[];
}): JSX.Element {
  const [selectedFrame, setSelectedFrame] = React.useState<number>(0);

  if (framePaths.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 bg-muted rounded-lg">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Image className="h-8 w-8" />
          <span className="text-sm">No frames available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Main frame display */}
      <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
        <img
          src={mediaUrl(framePaths[selectedFrame])}
          alt={`Frame ${selectedFrame + 1}`}
          className="w-full h-full object-contain"
        />
      </div>

      {/* Frame thumbnails */}
      {framePaths.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {framePaths.map((framePath, index) => (
            <button
              key={framePath}
              onClick={() => setSelectedFrame(index)}
              className={cn(
                'relative flex-shrink-0 w-20 h-12 rounded overflow-hidden border-2 transition-colors',
                index === selectedFrame
                  ? 'border-primary'
                  : 'border-transparent hover:border-muted-foreground/50'
              )}
            >
              <img
                src={mediaUrl(framePath)}
                alt={`Frame ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArtifactsSection({ video }: { video: VideoItem }): JSX.Element | null {
  // Artifacts come from CLI scan - check what's available
  const framePaths = video.artifacts?.framePaths ?? [];
  const hasFrames = framePaths.length > 0;
  const hasTranscript = !!video.artifacts?.transcriptContent;
  // Structured summary from CLI artifacts (summaries/NAME.json)
  const summary = video.artifacts?.summary ?? null;
  const hasSummary = summary !== null;
  // A summary should exist for these statuses - show an empty state if it's missing
  const summaryExpected = video.status === 'analyzed' || video.status === 'completed';

  // Show artifacts when available (summary, transcript, frames)
  if (!(hasSummary || hasTranscript || hasFrames || summaryExpected)) {
    return null;
  }

  return (
    <>
      {/* Summary */}
      {summary && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">Summary</h3>
          </div>
          <p className="text-sm">{summary.description}</p>
          {summary.suggestedFilename && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Suggested filename:</span>{' '}
              <code className="bg-muted px-1 py-0.5 rounded">
                {summary.suggestedFilename}
              </code>
            </div>
          )}
        </div>
      )}

      {/* Summary missing for a video that should have one */}
      {!summary && summaryExpected && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">Summary</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            No summary available. Run the analysis again to generate it.
          </p>
        </div>
      )}

      {/* Extracted Frames */}
      {hasFrames && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Image className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">
              Extracted Frames ({framePaths.length})
            </h3>
          </div>
          <FrameGallery key={video.path} framePaths={framePaths} />
        </div>
      )}

      {/* Transcript */}
      {hasTranscript && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">Transcript</h3>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {video.artifacts?.transcriptContent}
            </p>
          </div>
        </div>
      )}

      {/* Full Analysis (collapsible) */}
      {summary?.fullAnalysis && (
        <details className="rounded-lg border border-border bg-card overflow-hidden">
          <summary className="p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <span className="font-medium text-sm">Full AI Analysis</span>
          </summary>
          <div className="px-4 pb-4">
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {summary.fullAnalysis}
            </p>
          </div>
        </details>
      )}
    </>
  );
}
