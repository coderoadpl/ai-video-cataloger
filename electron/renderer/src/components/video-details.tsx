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

/**
 * Artifact data for a completed video
 */
export interface VideoArtifacts {
  summary: string | null;
  transcript: string | null;
  framePaths: string[];
  frameDataUrls: (string | null)[];
}

interface VideoDetailsProps {
  video: VideoItem;
  currentFolder: string;
  onAnalyze?: (video: VideoItem) => void;
  isAnalyzing?: boolean;
  className?: string;
}

/**
 * Get status display info
 */
function getStatusInfo(status: VideoStatus): {
  label: string;
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  description: string;
} {
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
        label: 'Frames Extracted',
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-100',
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        description: 'Frames have been extracted. Processing continues.',
      };
    case 'audio_extracted':
      return {
        label: 'Audio Extracted',
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-100',
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        description: 'Audio has been extracted. Transcribing.',
      };
    case 'transcribed':
      return {
        label: 'Transcribed',
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-100',
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        description: 'Transcript ready. Running AI analysis.',
      };
    case 'analyzed':
      return {
        label: 'Analyzed',
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-100',
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        description: 'Analysis complete. Finalizing.',
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
 * Get artifact paths for a video
 */
function getArtifactPaths(videoPath: string, folderPath: string): {
  summaryPath: string;
  transcriptPath: string;
  framesDir: string;
} {
  // Extract video name without extension
  const videoFilename = videoPath.split('/').pop() || '';
  const videoName = videoFilename.replace(/\.[^.]+$/, '');

  return {
    summaryPath: `${folderPath}/summaries/${videoName}.txt`,
    transcriptPath: `${folderPath}/transcripts/${videoName}.txt`,
    framesDir: `${folderPath}/frames/${videoName}`,
  };
}

/**
 * Parse summary file to extract description and suggested filename
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
  let inFullAnalysis = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('DESCRIPTION:')) {
      description = trimmed.substring('DESCRIPTION:'.length).trim();
    } else if (trimmed.startsWith('SUGGESTED FILENAME:')) {
      suggestedFilename = trimmed.substring('SUGGESTED FILENAME:'.length).trim();
    } else if (trimmed.startsWith('FULL ANALYSIS:')) {
      inFullAnalysis = true;
    } else if (inFullAnalysis) {
      fullAnalysis += line + '\n';
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
  currentFolder,
  onAnalyze,
  isAnalyzing = false,
  className,
}: VideoDetailsProps): JSX.Element {
  const [artifacts, setArtifacts] = React.useState<VideoArtifacts | null>(null);
  const [isLoadingArtifacts, setIsLoadingArtifacts] = React.useState(false);

  const statusInfo = getStatusInfo(video.status);
  const isCompleted = video.status === 'completed';
  const isPending = video.status === 'pending' || video.status === 'not_tracked';
  const isError = video.status === 'error';

  // Load artifacts when video changes (only for completed videos)
  React.useEffect(() => {
    let cancelled = false;

    async function loadArtifacts(): Promise<void> {
      if (!isCompleted) {
        setArtifacts(null);
        return;
      }

      setIsLoadingArtifacts(true);

      try {
        const paths = getArtifactPaths(video.path, currentFolder);

        // Load summary and transcript in parallel
        const [summary, transcript] = await Promise.all([
          window.electronAPI?.file.readText(paths.summaryPath) || null,
          window.electronAPI?.file.readText(paths.transcriptPath) || null,
        ]);

        // Get frame files
        const frameFiles = await window.electronAPI?.file.readDir(paths.framesDir) || [];
        const jpgFiles = frameFiles
          .filter((f: string) => f.endsWith('.jpg'))
          .sort();

        // Load frame images
        const framePaths = jpgFiles.map((f: string) => `${paths.framesDir}/${f}`);
        const frameDataUrls = await Promise.all(
          framePaths.map((fp: string) => window.electronAPI?.file.readAsDataUrl(fp) || null)
        );

        if (!cancelled) {
          setArtifacts({
            summary,
            transcript,
            framePaths,
            frameDataUrls,
          });
        }
      } catch (error) {
        console.error('Failed to load artifacts:', error);
        if (!cancelled) {
          setArtifacts(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingArtifacts(false);
        }
      }
    }

    loadArtifacts();

    return () => {
      cancelled = true;
    };
  }, [video.path, video.status, currentFolder, isCompleted]);

  // Parse summary if available
  const parsedSummary = artifacts?.summary ? parseSummary(artifacts.summary) : null;

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-6 space-y-6">
        {/* Header with thumbnail and basic info */}
        <div className="flex gap-4">
          {/* Thumbnail */}
          <div className="relative w-32 h-20 rounded-lg overflow-hidden bg-muted flex-shrink-0">
            {video.thumbnailDataUrl ? (
              <img
                src={video.thumbnailDataUrl}
                alt={video.filename}
                className="w-full h-full object-cover"
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

        {/* Loading artifacts */}
        {isCompleted && isLoadingArtifacts && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Loading analysis results...</span>
            </div>
          </div>
        )}

        {/* Completed state: Show summary, transcript, and frames */}
        {isCompleted && artifacts && !isLoadingArtifacts && (
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
            {artifacts.frameDataUrls.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Image className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium text-sm">
                    Extracted Frames ({artifacts.frameDataUrls.filter(Boolean).length})
                  </h3>
                </div>
                <FrameGallery frameDataUrls={artifacts.frameDataUrls} />
              </div>
            )}

            {/* Transcript */}
            {artifacts.transcript && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium text-sm">Transcript</h3>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {artifacts.transcript}
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
