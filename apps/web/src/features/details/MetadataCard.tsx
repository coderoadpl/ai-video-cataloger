import { type ReactNode } from 'react';
import { Box, Button, Chip, Paper, Typography } from '@mui/material';

import { ClockIcon, FolderIcon, PlaceIcon, StorageIcon } from '../../components/ui/icons.js';
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

const Row = ({
  icon,
  label,
  value,
  action,
  testId,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  action?: ReactNode;
  testId?: string;
}) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
    <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
    <Typography variant="body2" color="text.secondary">
      {label}:
    </Typography>
    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }} title={value} data-testid={testId}>
      {value}
    </Typography>
    {action}
  </Box>
);

interface MetadataCardProps {
  video: DetailsVideo;
  location?: DetailsLocation | null | undefined;
  onShowOnMap?: (() => void) | undefined;
  onShowInLibrary?: (() => void) | undefined;
}

export const MetadataCard = ({ video, location, onShowOnMap, onShowInLibrary }: MetadataCardProps) => {
  const dictionary = useDictionary();
  const approximate = location?.source !== null && location?.source !== undefined && location.source !== 'camera';

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="h2">{dictionary.details.videoInformation}</Typography>
      <Row
        icon={<ClockIcon fontSize="small" />}
        label={dictionary.details.duration}
        value={video.durationFormatted ?? dictionary.details.unknown}
      />
      <Row icon={<StorageIcon fontSize="small" />} label={dictionary.details.size} value={video.sizeFormatted} />
      <Row
        icon={<FolderIcon fontSize="small" />}
        label={dictionary.details.location}
        value={parentDir(video.path)}
        action={onShowInLibrary === undefined ? undefined : (
          <Button size="small" onClick={onShowInLibrary} data-testid="details-show-in-library">
            {dictionary.common.showInLibrary}
          </Button>
        )}
      />
      {location == null ? null : (
        <>
          <Row
            icon={<PlaceIcon fontSize="small" />}
            label={dictionary.details.coordinates}
            value={formatCoordinates(location.lat, location.lon)}
            testId="details-coordinates"
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
