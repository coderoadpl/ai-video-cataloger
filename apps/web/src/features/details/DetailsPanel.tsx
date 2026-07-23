import { Box, List, ListItem, Paper, Typography } from '@mui/material';

import { type DetailsVideo } from './details-video.js';
import { VideoDetails } from './VideoDetails.js';

interface DetailsPanelProps {
  video: DetailsVideo | null;
  analyzing: boolean;
  onAnalyze?: ((video: DetailsVideo) => void) | undefined;
  disabledReason?: string | undefined;
  onTagSearch?: ((tag: string) => void) | undefined;
}

const STEPS = [
  'Click "Open Folder" to select a folder with video files',
  'The sidebar will show all detected videos',
  'Select a video to view details and analysis results',
  'Click "Analyze" to process individual videos',
  'Terminal output shows real-time progress',
] as const;

const Welcome = () => (
  <Box sx={{ p: 4, maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 3 }}>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="h1">Welcome to AI Video Cataloger</Typography>
      <Typography variant="body2" color="text.secondary">
        Select a folder containing videos to get started. The app analyzes your videos locally to
        generate summaries, transcriptions, and smart file names.
      </Typography>
    </Box>
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h2" gutterBottom>
        Getting Started
      </Typography>
      <List dense sx={{ listStyleType: 'decimal', pl: 2.5 }}>
        {STEPS.map((step) => (
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

export const DetailsPanel = ({ video, analyzing, onAnalyze, disabledReason, onTagSearch }: DetailsPanelProps) =>
  video === null ? (
    <Welcome />
  ) : (
    <VideoDetails
      video={video}
      analyzing={analyzing}
      onAnalyze={onAnalyze}
      disabledReason={disabledReason}
      onTagSearch={onTagSearch}
    />
  );
