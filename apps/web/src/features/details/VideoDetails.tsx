import { Box, Typography } from '@mui/material';

import { MediaThumbnail } from '../../components/ui/MediaThumbnail.js';
import { VideoStatusBadge } from '../../components/ui/VideoStatusBadge.js';
import { ArtifactsSection } from './ArtifactsSection.js';
import { type DetailsVideo } from './details-video.js';
import { MetadataCard } from './MetadataCard.js';
import { StatusActions } from './StatusActions.js';
import { statusDescription } from './status-info.js';

interface VideoDetailsProps {
  video: DetailsVideo;
  analyzing: boolean;
  onAnalyze?: ((video: DetailsVideo) => void) | undefined;
}

/**
 * The selected video's detail view: header (thumbnail, name, path, status
 * badge), metadata card, status description, the per-status action card, and
 * the artifacts region (parity-inventory §2).
 */
export const VideoDetails = ({ video, analyzing, onAnalyze }: VideoDetailsProps) => (
  <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 780 }}>
    <Box sx={{ display: 'flex', gap: 2 }}>
      <MediaThumbnail
        path={video.artifacts.thumbnailPath}
        mtime={video.artifacts.thumbnailMtime}
        alt={video.filename}
        width={128}
        height={80}
      />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography variant="h1" noWrap title={video.filename}>
          {video.filename}
        </Typography>
        <Typography variant="caption" noWrap title={video.path}>
          {video.path}
        </Typography>
        <Box>
          <VideoStatusBadge status={video.status} analyzing={analyzing} variant="details" />
        </Box>
      </Box>
    </Box>

    <MetadataCard video={video} />

    <Typography variant="body2" color="text.secondary">
      {statusDescription(video.status, analyzing)}
    </Typography>

    <StatusActions video={video} analyzing={analyzing} onAnalyze={onAnalyze} />

    <ArtifactsSection video={video} />
  </Box>
);
