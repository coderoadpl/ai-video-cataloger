import { type ReactNode } from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';

import { ClockIcon, FolderIcon, PlaceIcon, StorageIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCoordinates } from '../../lib/format.js';
import { parentDir } from '../../lib/media-url.js';
import { type DetailsVideo } from './details-video.js';

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
  location?: { lat: number; lon: number } | null | undefined;
  onShowOnMap?: (() => void) | undefined;
}

export const MetadataCard = ({ video, location, onShowOnMap }: MetadataCardProps) => {
  const dictionary = useDictionary();

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="h2">{dictionary.details.videoInformation}</Typography>
      <Row
        icon={<ClockIcon fontSize="small" />}
        label={dictionary.details.duration}
        value={video.durationFormatted ?? dictionary.details.unknown}
      />
      <Row icon={<StorageIcon fontSize="small" />} label={dictionary.details.size} value={video.sizeFormatted} />
      <Row icon={<FolderIcon fontSize="small" />} label={dictionary.details.location} value={parentDir(video.path)} />
      {location == null ? null : (
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
      )}
    </Paper>
  );
};
