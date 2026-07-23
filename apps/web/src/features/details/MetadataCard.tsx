import { type ReactNode } from 'react';
import { Box, Paper, Typography } from '@mui/material';

import { ClockIcon, FolderIcon, StorageIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { parentDir } from '../../lib/media-url.js';
import { type DetailsVideo } from './details-video.js';

const Row = ({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
    <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
    <Typography variant="body2" color="text.secondary">
      {label}:
    </Typography>
    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }} title={value}>
      {value}
    </Typography>
  </Box>
);

export const MetadataCard = ({ video }: { video: DetailsVideo }) => {
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
    </Paper>
  );
};
