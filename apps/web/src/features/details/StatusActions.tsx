import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';

import { PlayCircleIcon } from '../../components/ui/icons.js';
import { type DetailsVideo, isIncomplete } from './details-video.js';

interface StatusActionsProps {
  video: DetailsVideo;
  analyzing: boolean;
  onAnalyze?: ((video: DetailsVideo) => void) | undefined;
  disabledReason?: string | undefined;
}

const spinner = <CircularProgress size={16} color="inherit" />;
const play = <PlayCircleIcon fontSize="small" />;

export const StatusActions = ({ video, analyzing, onAnalyze, disabledReason }: StatusActionsProps) => {
  if (onAnalyze === undefined) return null;
  const run = () => onAnalyze(video);

  if (video.status === 'pending' || video.status === 'not_tracked') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Button
          data-testid="analyze-button"
          variant="contained"
          fullWidth
          disabled={analyzing || disabledReason !== undefined}
          startIcon={analyzing ? spinner : play}
          onClick={run}
        >
          {analyzing ? 'Analyzing…' : 'Analyze Video'}
        </Button>
        <Typography variant="caption" align="center">
          {disabledReason ?? 'This will extract frames, transcribe audio, and generate a summary using AI.'}
        </Typography>
      </Box>
    );
  }

  if (isIncomplete(video.status)) {
    return (
      <Alert
        severity="warning"
        icon={false}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        <Typography variant="h2">Processing Incomplete</Typography>
        <Typography variant="body2">
          A previous processing attempt was interrupted. Click the button below to restart.
        </Typography>
        <Button
          data-testid="analyze-button"
          variant="outlined"
          color="inherit"
          fullWidth
          disabled={analyzing || disabledReason !== undefined}
          startIcon={analyzing ? spinner : play}
          onClick={run}
        >
          {analyzing ? 'Processing…' : 'Continue Analysis'}
        </Button>
      </Alert>
    );
  }

  if (video.status === 'error') {
    return (
      <Alert severity="error" icon={false} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h2">Processing Failed</Typography>
        {video.errorMessage != null && video.errorMessage.length > 0 ? (
          <Typography variant="body2">{video.errorMessage}</Typography>
        ) : null}
        <Box>
          <Button
            data-testid="analyze-button"
            variant="outlined"
            color="inherit"
            size="small"
            disabled={analyzing || disabledReason !== undefined}
            startIcon={analyzing ? spinner : undefined}
            onClick={run}
          >
            {analyzing ? 'Retrying…' : 'Retry Analysis'}
          </Button>
        </Box>
      </Alert>
    );
  }

  return null;
};
