/**
 * MetadataCard - the "Video Information" card (duration, size, location).
 * Extracted from video-details.tsx.
 */

import * as React from 'react';
import { Clock, HardDrive, FolderOpen } from 'lucide-react';
import type { VideoItem } from '@/components/video-list';

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

export function MetadataCard({ video }: { video: VideoItem }): JSX.Element {
  return (
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
  );
}
