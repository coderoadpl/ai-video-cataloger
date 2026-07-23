import { useMemo } from 'react';
import { Box } from '@mui/material';

import { mediaUrl } from '../../lib/media-url.js';
import { buildWebVtt } from './subtitles.js';
import { type DetailsVideo } from './details-video.js';

interface VideoPlayerProps {
  video: DetailsVideo;
}

export const VideoPlayer = ({ video }: VideoPlayerProps) => {
  const vtt = useMemo(() => buildWebVtt(video.artifacts.transcriptSegments ?? []), [video.artifacts.transcriptSegments]);
  const trackUrl = vtt === null ? null : `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;

  return (
    <Box
      component="video"
      src={mediaUrl(video.path)}
      controls
      preload="metadata"
      data-testid="detail-video-player"
      sx={{
        display: 'block',
        width: '100%',
        maxHeight: 440,
        bgcolor: 'common.black',
        borderRadius: 1,
      }}
    >
      {trackUrl === null ? null : (
        <track kind="subtitles" src={trackUrl} srcLang="en" label="Transcript" data-testid="detail-subtitles-track" />
      )}
    </Box>
  );
};
