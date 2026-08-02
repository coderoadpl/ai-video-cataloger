import { Box, Chip, Dialog, DialogContent, DialogTitle, Link, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { useSubtitlesTrackUrl } from '../../components/ui/use-subtitles-track-url.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt, formatCoordinates } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import { playerBoxForSource } from '../../lib/player-box.js';
import { OpenInNewIcon } from '../../components/ui/icons.js';
import type { PreviewMedia } from './core/index.js';

const PREVIEW_PLAYER_MAX_HEIGHT = 420;

interface BrowsePreviewProps {
  item: PreviewMedia | null;
  onClose: () => void;
  onOpenInAnalysis: (folderPath: string, videoPath: string) => void;
}

const Row = ({ label, value, testId }: { label: string; value: string | null; testId?: string }) => {
  if (value === null) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" data-testid={testId}>{value}</Typography>
    </Box>
  );
};

export const BrowsePreview = ({ item, onClose, onOpenInAnalysis }: BrowsePreviewProps) => {
  const dictionary = useDictionary();
  const detail = useQuery({
    ...actions.libraryPreview({ fingerprint: item?.fingerprint ?? '' }),
    enabled: item !== null,
  });
  const people = detail.data?.people ?? [];
  const trackUrl = useSubtitlesTrackUrl(detail.data?.transcriptSegments);
  const box = playerBoxForSource(
    { width: detail.data?.width ?? null, height: detail.data?.height ?? null, rotation: detail.data?.rotation ?? null },
    PREVIEW_PLAYER_MAX_HEIGHT,
  );

  return (
    <Dialog open={item !== null} onClose={onClose} maxWidth="md" fullWidth data-testid="browse-preview">
      {item === null ? null : (
        <>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h2" component="span" sx={{ flex: 1, minWidth: 0 }} noWrap title={item.title}>
              {item.title}
            </Typography>
            {item.online ? (
              <Link
                component="button"
                variant="body2"
                underline="hover"
                data-testid="preview-open-analysis"
                onClick={() => {
                  onOpenInAnalysis(item.folderPath, item.path);
                  onClose();
                }}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
              >
                <OpenInNewIcon fontSize="small" />
                {dictionary.preview.openInAnalysis}
              </Link>
            ) : (
              <Typography variant="body2" color="text.disabled" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <OpenInNewIcon fontSize="small" />
                {dictionary.preview.openInAnalysis}
              </Typography>
            )}
          </DialogTitle>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {item.online && !item.missing ? (
              <Box
                component="video"
                controls
                preload="metadata"
                src={mediaUrl(item.path)}
                {...(item.posterPath === null ? {} : { poster: mediaUrl(item.posterPath, item.fingerprint) })}
                data-testid="preview-player"
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
                }}
              >
                {trackUrl === null ? null : (
                  <track
                    kind="subtitles"
                    default
                    src={trackUrl}
                    srcLang="en"
                    label={dictionary.details.transcript}
                    data-testid="preview-subtitles-track"
                  />
                )}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" data-testid="preview-unavailable">
                {item.online ? dictionary.preview.missing : dictionary.preview.offline}
              </Typography>
            )}
            <Row label={dictionary.details.location} value={item.path} testId="preview-path" />
            <Row label={dictionary.details.duration} value={detail.data?.durationFormatted ?? null} />
            <Row label={dictionary.details.size} value={detail.data?.sizeFormatted ?? null} />
            <Row label={dictionary.photos.detailDescription} value={item.description} />
            {item.tags.length === 0 ? null : (
              <Box>
                <Typography variant="caption" color="text.secondary">{dictionary.photos.detailTags}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {item.tags.map((tag) => (
                    <Chip key={tag} label={tag} size="small" data-testid="preview-tag-chip" />
                  ))}
                </Box>
              </Box>
            )}
            <Row label={dictionary.map.place} value={item.placeName} />
            {item.gps === null ? null : (
              <Row
                label={dictionary.details.coordinates}
                value={formatCoordinates(item.gps.lat, item.gps.lon)}
                testId="preview-coordinates"
              />
            )}
            <Row label={dictionary.photos.detailCaptured} value={formatCapturedAt(item.capturedAt)} />
            {people.length === 0 ? null : (
              <Box>
                <Typography variant="caption" color="text.secondary">{dictionary.people.title}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {people.map((person) => (
                    <Chip
                      key={person.personId}
                      label={person.displayName ?? person.personId}
                      size="small"
                      data-testid="preview-person-chip"
                    />
                  ))}
                </Box>
              </Box>
            )}
            {detail.data === undefined || detail.data.transcript === null || detail.data.transcript.length === 0 ? null : (
              <Box>
                <Typography variant="caption" color="text.secondary">{dictionary.details.transcript}</Typography>
                <Box sx={{ maxHeight: 200, overflowY: 'auto', mt: 0.5 }} data-testid="preview-transcript">
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                    {detail.data.transcript}
                  </Typography>
                </Box>
              </Box>
            )}
          </DialogContent>
        </>
      )}
    </Dialog>
  );
};
