/**
 * VideoDetails component
 * Displays details of a selected video including metadata, summary, transcript, and frames
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Film,
  Clock,
  HardDrive,
  FileText,
  Image,
  AlertCircle,
  CheckCircle2,
  PlayCircle,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import type { VideoItem, VideoStatus } from './video-list';

interface VideoDetailsProps {
  video: VideoItem;
  currentFolder: string;
  onAnalyze?: (video: VideoItem) => void;
  isAnalyzing?: boolean;
  className?: string;
}

/**
 * Get status display info
 * @param status - The video status from database
 * @param isCurrentlyAnalyzing - Whether this video is currently being analyzed
 */
function getStatusInfo(status: VideoStatus, isCurrentlyAnalyzing: boolean = false): {
  label: string;
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  description: string;
} {
  // If currently being analyzed, always show processing state
  if (isCurrentlyAnalyzing) {
    return {
      label: 'Processing',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-100',
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      description: 'Video is being processed...',
    };
  }

  switch (status) {
    case 'completed':
      return {
        label: 'Completed',
        color: 'text-green-600',
        bgColor: 'bg-green-100',
        icon: <CheckCircle2 className="h-4 w-4" />,
        description: 'Analysis complete. Summary, transcript, and frames are available.',
      };
    case 'error':
      return {
        label: 'Error',
        color: 'text-red-600',
        bgColor: 'bg-red-100',
        icon: <AlertCircle className="h-4 w-4" />,
        description: 'An error occurred during processing.',
      };
    case 'pending':
      return {
        label: 'Pending',
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
        icon: <Clock className="h-4 w-4" />,
        description: 'Ready to be analyzed.',
      };
    case 'frames_extracted':
      return {
        label: 'Incomplete',
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
        icon: <AlertCircle className="h-4 w-4" />,
        description: 'Processing was interrupted at frames extraction step. Click Analyze to continue.',
      };
    case 'audio_extracted':
      return {
        label: 'Incomplete',
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
        icon: <AlertCircle className="h-4 w-4" />,
        description: 'Processing was interrupted at audio extraction step. Click Analyze to continue.',
      };
    case 'transcribed':
      return {
        label: 'Incomplete',
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
        icon: <AlertCircle className="h-4 w-4" />,
        description: 'Processing was interrupted at transcription step. Click Analyze to continue.',
      };
    case 'analyzed':
      return {
        label: 'Incomplete',
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
        icon: <AlertCircle className="h-4 w-4" />,
        description: 'Processing was interrupted at analysis step. Click Analyze to continue.',
      };
    case 'not_tracked':
    default:
      return {
        label: 'Not Tracked',
        color: 'text-gray-500',
        bgColor: 'bg-gray-100',
        icon: <Film className="h-4 w-4" />,
        description: 'This video has not been processed yet.',
      };
  }
}

/**
 * Parse summary file to extract description and suggested filename
 * Handles multi-line format where section labels are on separate lines from content
 */
function parseSummary(summaryText: string): {
  description: string;
  suggestedFilename: string;
  fullAnalysis: string;
} {
  const lines = summaryText.split('\n');
  let description = '';
  let suggestedFilename = '';
  let fullAnalysis = '';

  // Track which section we're currently in
  let currentSection: 'none' | 'description' | 'filename' | 'fullAnalysis' = 'none';

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for section headers
    if (trimmed.startsWith('FULL ANALYSIS:')) {
      currentSection = 'fullAnalysis';
      // Capture any content on the same line
      const sameLine = trimmed.substring('FULL ANALYSIS:'.length).trim();
      if (sameLine) fullAnalysis += sameLine + '\n';
    } else if (trimmed.startsWith('DESCRIPTION:')) {
      currentSection = 'description';
      // Capture any content on the same line
      const sameLine = trimmed.substring('DESCRIPTION:'.length).trim();
      if (sameLine) description = sameLine;
    } else if (trimmed.startsWith('SUGGESTED FILENAME:')) {
      currentSection = 'filename';
      // Capture any content on the same line
      const sameLine = trimmed.substring('SUGGESTED FILENAME:'.length).trim();
      if (sameLine) suggestedFilename = sameLine;
    } else if (trimmed.startsWith('Video:') || trimmed.startsWith('Date Analyzed:')) {
      // Skip header lines
      currentSection = 'none';
    } else if (trimmed) {
      // Non-empty line - add to current section
      switch (currentSection) {
        case 'description':
          description = description ? description + ' ' + trimmed : trimmed;
          break;
        case 'filename':
          suggestedFilename = suggestedFilename || trimmed;
          break;
        case 'fullAnalysis':
          fullAnalysis += line + '\n';
          break;
      }
    }
  }

  return {
    description: description || 'No description available',
    suggestedFilename,
    fullAnalysis: fullAnalysis.trim(),
  };
}

/**
 * MetadataRow component
 */
function MetadataRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * FrameGallery component
 */
function FrameGallery({
  frameDataUrls,
}: {
  frameDataUrls: (string | null)[];
}): JSX.Element {
  const [selectedFrame, setSelectedFrame] = React.useState<number>(0);

  const validFrames = frameDataUrls.filter((url): url is string => url !== null);

  if (validFrames.length === 0) {
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
          src={validFrames[selectedFrame]}
          alt={`Frame ${selectedFrame + 1}`}
          className="w-full h-full object-contain"
        />
      </div>

      {/* Frame thumbnails */}
      {validFrames.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {validFrames.map((url, index) => (
            <button
              key={index}
              onClick={() => setSelectedFrame(index)}
              className={cn(
                'relative flex-shrink-0 w-20 h-12 rounded overflow-hidden border-2 transition-colors',
                index === selectedFrame
                  ? 'border-primary'
                  : 'border-transparent hover:border-muted-foreground/50'
              )}
            >
              <img
                src={url}
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

/**
 * VideoDetails component
 */
export function VideoDetails({
  video,
  currentFolder: _currentFolder,
  onAnalyze,
  isAnalyzing = false,
  className,
}: VideoDetailsProps): JSX.Element {
  const [frameDataUrls, setFrameDataUrls] = React.useState<(string | null)[]>([]);
  const [isLoadingFrames, setIsLoadingFrames] = React.useState(false);
  const [thumbnailError, setThumbnailError] = React.useState(false);

  // Reset thumbnail error when video changes
  React.useEffect(() => {
    setThumbnailError(false);
  }, [video.path]);

  const statusInfo = getStatusInfo(video.status, isAnalyzing);
  const isPending = video.status === 'pending' || video.status === 'not_tracked';
  const isIncomplete = ['frames_extracted', 'audio_extracted', 'transcribed', 'analyzed'].includes(video.status);
  const isError = video.status === 'error';

  // Artifacts come from CLI scan - check what's available
  const hasFrames = video.artifacts?.framePaths && video.artifacts.framePaths.length > 0;
  const hasTranscript = !!video.artifacts?.transcriptContent;
  const hasSummary = !!video.artifacts?.summaryContent;

  // Load frame images when frame paths are available
  React.useEffect(() => {
    let cancelled = false;

    async function loadFrameImages(): Promise<void> {
      if (!hasFrames || !video.artifacts?.framePaths) {
        setFrameDataUrls([]);
        return;
      }

      setIsLoadingFrames(true);

      try {
        const dataUrls = await Promise.all(
          video.artifacts.framePaths.map((fp: string) =>
            window.electronAPI?.file.readAsDataUrl(fp) || null
          )
        );

        if (!cancelled) {
          setFrameDataUrls(dataUrls);
        }
      } catch (error) {
        console.error('Failed to load frame images:', error);
        if (!cancelled) {
          setFrameDataUrls([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingFrames(false);
        }
      }
    }

    loadFrameImages();

    return () => {
      cancelled = true;
    };
  }, [video.path, video.artifacts?.framePaths, hasFrames]);

  // Parse summary if available (from CLI artifacts)
  const parsedSummary = hasSummary && video.artifacts?.summaryContent
    ? parseSummary(video.artifacts.summaryContent)
    : null;

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-6 space-y-6">
        {/* Header with thumbnail and basic info */}
        <div className="flex gap-4">
          {/* Thumbnail */}
          <div className="relative w-32 h-20 rounded-lg overflow-hidden bg-muted flex-shrink-0">
            {video.thumbnailDataUrl && !thumbnailError ? (
              <img
                src={video.thumbnailDataUrl}
                alt={video.filename}
                className="w-full h-full object-cover"
                onError={() => setThumbnailError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Film className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Basic info */}
          <div className="flex-1 min-w-0 space-y-1">
            <h2 className="text-lg font-semibold truncate" title={video.filename}>
              {video.filename}
            </h2>
            <p className="text-xs text-muted-foreground truncate" title={video.path}>
              {video.path}
            </p>
            {/* Status badge */}
            <div
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded text-sm font-medium',
                statusInfo.bgColor,
                statusInfo.color
              )}
            >
              {statusInfo.icon}
              <span>{statusInfo.label}</span>
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h3 className="font-medium text-sm mb-3">Video Information</h3>
          <MetadataRow
            icon={<Clock className="h-4 w-4" />}
            label="Duration"
            value={video.durationFormatted || 'Unknown'}
          />
          <MetadataRow
            icon={<HardDrive className="h-4 w-4" />}
            label="Size"
            value={video.sizeFormatted}
          />
          <MetadataRow
            icon={<FolderOpen className="h-4 w-4" />}
            label="Location"
            value={video.path.split('/').slice(0, -1).join('/') || '/'}
          />
        </div>

        {/* Status description */}
        <div className="text-sm text-muted-foreground">
          {statusInfo.description}
        </div>

        {/* Pending state: Show Analyze button */}
        {isPending && onAnalyze && (
          <div className="space-y-4">
            <Button
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

        {/* Loading frame images */}
        {hasFrames && isLoadingFrames && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Loading frames...</span>
            </div>
          </div>
        )}

        {/* Show artifacts when available (summary, transcript, frames) */}
        {(hasSummary || hasTranscript || hasFrames) && (
          <>
            {/* Summary */}
            {parsedSummary && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium text-sm">Summary</h3>
                </div>
                <p className="text-sm">{parsedSummary.description}</p>
                {parsedSummary.suggestedFilename && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Suggested filename:</span>{' '}
                    <code className="bg-muted px-1 py-0.5 rounded">
                      {parsedSummary.suggestedFilename}
                    </code>
                  </div>
                )}
              </div>
            )}

            {/* Extracted Frames */}
            {frameDataUrls.length > 0 && !isLoadingFrames && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Image className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium text-sm">
                    Extracted Frames ({frameDataUrls.filter(Boolean).length})
                  </h3>
                </div>
                <FrameGallery frameDataUrls={frameDataUrls} />
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
            {parsedSummary?.fullAnalysis && (
              <details className="rounded-lg border border-border bg-card overflow-hidden">
                <summary className="p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                  <span className="font-medium text-sm">Full AI Analysis</span>
                </summary>
                <div className="px-4 pb-4">
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {parsedSummary.fullAnalysis}
                  </p>
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

export type { VideoDetailsProps };
