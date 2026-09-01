import { useQuery } from '@tanstack/react-query';
import { Box, Chip, Typography } from '@mui/material';

import { actions } from '../../api.js';
import { useSubtitlesTrackUrl } from '../../components/ui/use-subtitles-track-url.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt, formatCoordinates } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import { playerBoxForSource } from '../../lib/player-box.js';
import { videoViewerStage, type LibraryVideoItem } from './core/index.js';
import { ViewerDetailRow } from './ViewerDetailRow.js';

const STAGE_MAX_HEIGHT_PX = 720;

export const LibraryVideoStage = ({ item }: { item: LibraryVideoItem }) => {
  const dictionary = useDictionary();
  const detail = useQuery(actions.libraryPreview({ fingerprint: item.fingerprint }));
  const trackUrl = useSubtitlesTrackUrl(detail.data?.transcriptSegments);
  const stage = videoViewerStage(item);
  const box = playerBoxForSource(
    { width: detail.data?.width ?? null, height: detail.data?.height ?? null, rotation: detail.data?.rotation ?? null },
    STAGE_MAX_HEIGHT_PX,
  );

  if (stage.kind === 'unavailable') {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="library-media-viewer-unavailable">
        {stage.reason === 'drive-disconnected' ? dictionary.preview.offline : dictionary.preview.missing}
      </Typography>
    );
  }

  return (
    <Box
      component="video"
      controls
      preload="metadata"
      src={mediaUrl(stage.path)}
      {...(stage.posterPath === null ? {} : { poster: mediaUrl(stage.posterPath, item.fingerprint) })}
      data-testid="library-media-viewer-player"
      data-player-aspect={box.aspectRatio}
      sx={{
        display: 'block',
        width: '100%',
        maxWidth: box.maxWidthPx === null ? '100%' : box.maxWidthPx,
        aspectRatio: String(box.aspectRatio),
        maxHeight: '100%',
        objectFit: 'contain',
        bgcolor: 'common.black',
      }}
    >
      {trackUrl === null ? null : (
        <track
          kind="subtitles"
          default
          src={trackUrl}
          srcLang="en"
          label={dictionary.details.transcript}
          data-testid="library-media-viewer-subtitles-track"
        />
      )}
    </Box>
  );
};

export const LibraryVideoDetails = ({ item }: { item: LibraryVideoItem }) => {
  const dictionary = useDictionary();
  const detail = useQuery(actions.libraryPreview({ fingerprint: item.fingerprint }));
  const people = detail.data?.people ?? [];
  const transcript = detail.data?.transcript ?? null;
  const provenance = detail.data?.analysis ?? null;
  const provenanceTimestamp = provenance === null ? null : formatCapturedAt(provenance.createdAt, dictionary.locale);

  return (
    <>
      <ViewerDetailRow
        label={dictionary.photos.detailDescription}
        value={item.description}
        testId="library-media-viewer-description"
      />
      {item.tags.length === 0 ? null : (
        <Box data-testid="library-media-viewer-tags">
          <Typography variant="caption" color="text.secondary">{dictionary.photos.detailTags}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {item.tags.map((tag) => <Chip key={tag} label={tag} size="small" />)}
          </Box>
        </Box>
      )}
      {transcript === null || transcript.length === 0 ? null : (
        <Box data-testid="library-media-viewer-transcript">
          <Typography variant="caption" color="text.secondary">{dictionary.details.transcript}</Typography>
          <Box sx={{ maxHeight: 200, overflowY: 'auto', mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{transcript}</Typography>
          </Box>
        </Box>
      )}
      <ViewerDetailRow
        label={dictionary.details.location}
        value={`${item.folder.currentPath}/${item.fileName}`}
        testId="library-media-viewer-path"
      />
      <ViewerDetailRow label={dictionary.details.duration} value={detail.data?.durationFormatted ?? null} />
      <ViewerDetailRow label={dictionary.details.size} value={detail.data?.sizeFormatted ?? null} />
      <ViewerDetailRow label={dictionary.map.place} value={item.place?.name ?? null} />
      <ViewerDetailRow
        label={dictionary.details.coordinates}
        value={item.gps === null ? null : formatCoordinates(item.gps.lat, item.gps.lon)}
      />
      {people.length === 0 ? null : (
        <Box data-testid="library-media-viewer-people">
          <Typography variant="caption" color="text.secondary">{dictionary.people.title}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {people.map((person) => (
              <Chip key={person.personId} label={person.displayName ?? person.personId} size="small" />
            ))}
          </Box>
        </Box>
      )}
      <ViewerDetailRow
        label={dictionary.photos.detailCaptured}
        value={formatCapturedAt(item.capturedAt, dictionary.locale)}
      />
      <ViewerDetailRow
        label={dictionary.photos.detailVariant}
        value={provenance === null
          ? null
          : provenanceTimestamp === null ? provenance.label : `${provenance.label} · ${provenanceTimestamp}`}
      />
    </>
  );
};
