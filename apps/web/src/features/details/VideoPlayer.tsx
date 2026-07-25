import { useMemo } from 'react';
import { Box } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { playerBoxForSource } from '../../lib/player-box.js';
import { buildWebVtt } from './subtitles.js';
import { type DetailsVideo } from './details-video.js';

interface VideoPlayerProps {
  video: DetailsVideo;
}

const PLAYER_MAX_HEIGHT = 520;

export const VideoPlayer = ({ video }: VideoPlayerProps) => {
  const dictionary = useDictionary();
  const vtt = useMemo(() => buildWebVtt(video.artifacts.transcriptSegments ?? []), [video.artifacts.transcriptSegments]);
  const trackUrl = vtt === null ? null : `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
  const box = playerBoxForSource(video.source, PLAYER_MAX_HEIGHT);

  return (
    <Box
      component="video"
      src={mediaUrl(video.path)}
      controls
      preload="metadata"
      data-testid="detail-video-player"
      data-player-aspect={box.aspectRatio}
      sx={{
        display: 'block',
        width: '100%',
        maxWidth: box.maxWidthPx === null ? '100%' : box.maxWidthPx,
        aspectRatio: String(box.aspectRatio),
        maxHeight: box.maxHeightPx,
        mx: 'auto',
        objectFit: 'contain',
        bgcolor: 'common.black',
        borderRadius: 1,
      }}
    >
      {trackUrl === null ? null : (
        <track
          kind="subtitles"
          default
          src={trackUrl}
          srcLang="en"
          label={dictionary.details.transcript}
          data-testid="detail-subtitles-track"
        />
      )}
    </Box>
  );
};
