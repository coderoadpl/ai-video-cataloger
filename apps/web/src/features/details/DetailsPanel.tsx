import { Box, List, ListItem, Paper, Typography } from '@mui/material';

import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { type DetailsVideo } from './details-video.js';
import { DetailsSkeleton } from './DetailsSkeleton.js';
import { type DetailsLocation } from './MetadataCard.js';
import { VideoDetails } from './VideoDetails.js';

interface DetailsPanelProps {
  video: DetailsVideo | null;
  analyzing: boolean;
  loading?: boolean;
  onAnalyze?: ((video: DetailsVideo, options?: { force?: boolean }) => void) | undefined;
  onNavigateToCanonical?: ((canonicalPath: string) => void) | undefined;
  disabledReason?: string | undefined;
  onTagSearch?: ((tag: string) => void) | undefined;
  location?: DetailsLocation | null | undefined;
  onShowOnMap?: (() => void) | undefined;
}

const Welcome = ({ dictionary }: { dictionary: Dictionary }) => (
  <Box sx={{ p: 4, maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 3 }}>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="h1">{dictionary.details.welcomeTitle}</Typography>
      <Typography variant="body2" color="text.secondary">
        {dictionary.details.welcomeBody}
      </Typography>
    </Box>
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h2" gutterBottom>
        {dictionary.details.gettingStarted}
      </Typography>
      <List dense sx={{ listStyleType: 'decimal', pl: 2.5 }}>
        {dictionary.details.gettingStartedSteps.map((step) => (
          <ListItem key={step} sx={{ display: 'list-item', py: 0.25, px: 0 }} disableGutters>
            <Typography variant="body2" color="text.secondary">
              {step}
            </Typography>
          </ListItem>
        ))}
      </List>
    </Paper>
  </Box>
);

export const DetailsPanel = ({
  video,
  analyzing,
  loading = false,
  onAnalyze,
  onNavigateToCanonical,
  disabledReason,
  onTagSearch,
  location,
  onShowOnMap,
}: DetailsPanelProps) => {
  const dictionary = useDictionary();

  if (video === null && loading) return <DetailsSkeleton />;

  return video === null ? (
    <Welcome dictionary={dictionary} />
  ) : (
    <VideoDetails
      key={video.path}
      video={video}
      analyzing={analyzing}
      onAnalyze={onAnalyze}
      onNavigateToCanonical={onNavigateToCanonical}
      disabledReason={disabledReason}
      onTagSearch={onTagSearch}
      location={location}
      onShowOnMap={onShowOnMap}
    />
  );
};
