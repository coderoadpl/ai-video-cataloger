/**
 * Status display info for the VideoDetails status badge / description.
 * Extracted from video-details.tsx.
 */

import * as React from 'react';
import {
  Film,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import type { VideoStatus } from '@/components/video-list';

export interface StatusInfo {
  label: string;
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  description: string;
}

/**
 * Get status display info
 * @param status - The video status from database
 * @param isCurrentlyAnalyzing - Whether this video is currently being analyzed
 */
export function getStatusInfo(status: VideoStatus, isCurrentlyAnalyzing: boolean = false): StatusInfo {
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
