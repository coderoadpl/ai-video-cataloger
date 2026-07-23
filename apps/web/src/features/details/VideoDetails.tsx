import { Box, Chip, Typography } from '@mui/material';

import { VideoStatusBadge } from '../../components/ui/VideoStatusBadge.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { ArtifactsSection } from './ArtifactsSection.js';
import { type DetailsVideo } from './details-video.js';
import { MetadataCard } from './MetadataCard.js';
import { StatusActions } from './StatusActions.js';
import { statusDescription } from './status-info.js';
import { VideoPlayer } from './VideoPlayer.js';

interface VideoDetailsProps {
  video: DetailsVideo;
  analyzing: boolean;
  onAnalyze?: ((video: DetailsVideo) => void) | undefined;
  disabledReason?: string | undefined;
  onTagSearch?: ((tag: string) => void) | undefined;
}

export const VideoDetails = ({ video, analyzing, onAnalyze, disabledReason, onTagSearch }: VideoDetailsProps) => {
  const dictionary = useDictionary();

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 780 }}>
      <VideoPlayer video={video} />

      <Box sx={{ display: 'flex', gap: 2 }}>
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

      <TagRow tags={video.artifacts.summary?.tags ?? []} onTagSearch={onTagSearch} label={dictionary.details.videoTags} />

      <Typography variant="body2" color="text.secondary">
        {statusDescription(dictionary, video.status, analyzing)}
      </Typography>

      <StatusActions video={video} analyzing={analyzing} onAnalyze={onAnalyze} disabledReason={disabledReason} />

      <ArtifactsSection video={video} />
    </Box>
  );
};

const TagRow = ({
  tags,
  onTagSearch,
  label,
}: {
  tags: readonly string[];
  onTagSearch?: ((tag: string) => void) | undefined;
  label: string;
}) =>
  tags.length === 0 ? null : (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }} aria-label={label}>
      {tags.map((tag) => (
        <Chip
          key={tag}
          label={tag}
          size="small"
          clickable={onTagSearch !== undefined}
          onClick={onTagSearch === undefined ? undefined : () => onTagSearch(tag)}
        />
      ))}
    </Box>
  );
