import { Button, Chip, Paper, Typography } from '@mui/material';

import { ClockIcon, FolderIcon, PlaceIcon, StorageIcon } from '../../components/ui/icons.js';
import { DetailMetadataRow } from '../../components/ui/DetailMetadataRow.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCoordinates } from '../../lib/format.js';
import { parentDir } from '../../lib/media-url.js';
import { type DetailsVideo } from './details-video.js';

export interface DetailsLocation {
  lat: number;
  lon: number;
  source?: 'camera' | 'timeline' | 'manual' | null | undefined;
  accuracyM?: number | null | undefined;
  place?: { name: string; region: string | null; country: string | null } | null | undefined;
}

interface MetadataCardProps {
  video: DetailsVideo;
  location?: DetailsLocation | null | undefined;
  onShowOnMap?: (() => void) | undefined;
}

export const MetadataCard = ({ video, location, onShowOnMap }: MetadataCardProps) => {
  const dictionary = useDictionary();
  const approximate = location?.source !== null && location?.source !== undefined && location.source !== 'camera';

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="h2">{dictionary.details.videoInformation}</Typography>
      <DetailMetadataRow
        icon={<ClockIcon fontSize="small" />}
        label={dictionary.details.duration}
        value={video.durationFormatted ?? dictionary.details.unknown}
      />
      <DetailMetadataRow icon={<StorageIcon fontSize="small" />} label={dictionary.details.size} value={video.sizeFormatted} />
      <DetailMetadataRow
        icon={<FolderIcon fontSize="small" />}
        label={dictionary.details.location}
        value={parentDir(video.path)}
      />
      {location == null ? null : (
        <>
          <DetailMetadataRow
            icon={<PlaceIcon fontSize="small" />}
            label={dictionary.details.coordinates}
            value={formatCoordinates(location.lat, location.lon)}
            valueTestId="details-coordinates"
            action={onShowOnMap === undefined ? undefined : (
              <Button size="small" onClick={onShowOnMap} data-testid="details-show-on-map">
                {dictionary.details.showOnMap}
              </Button>
            )}
          />
          {location.source != null && (
            <Chip
              size="small"
              data-testid="details-gps-source-badge"
              label={approximate
                ? `${dictionary.map.source[location.source]}${location.accuracyM == null ? '' : ` ${dictionary.map.accuracy(Math.round(location.accuracyM))}`}`
                : dictionary.map.source.camera}
              sx={(theme) => ({
                alignSelf: 'flex-start',
                bgcolor: approximate ? theme.palette.map.pinApproximateHalo : theme.palette.status.completed.soft,
                color: approximate ? theme.palette.map.pinApproximate : theme.palette.status.completed.main,
              })}
            />
          )}
          {location.place != null && (
            <Typography variant="body2" color="text.secondary" data-testid="details-place">
              {[location.place.name, location.place.region, location.place.country].filter((value) => value !== null).join(' · ')}
            </Typography>
          )}
        </>
      )}
    </Paper>
  );
};
