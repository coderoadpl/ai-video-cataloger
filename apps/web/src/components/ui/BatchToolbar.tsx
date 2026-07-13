import { Box, Button, LinearProgress, Typography } from '@mui/material';

import { CancelIcon, PlayCircleIcon } from './icons.js';

export interface BatchProgressView {
  currentIndex: number;
  totalCount: number;
  currentFilename: string;
}

interface BatchToolbarProps {
  pendingCount: number;
  isBusy: boolean;
  batchProgress: BatchProgressView | null;
  onAnalyzeAll: () => void;
  onStop: () => void;
}

/**
 * The sidebar batch control (parity-inventory §2): an "Analyze All (N)" button
 * for the pending/not-tracked videos, replaced while a batch runs by the
 * current/total counter, the current filename, a progress bar and a Stop
 * button.
 */
export const BatchToolbar = ({
  pendingCount,
  isBusy,
  batchProgress,
  onAnalyzeAll,
  onStop,
}: BatchToolbarProps) => {
  if (batchProgress !== null) {
    const value = (batchProgress.currentIndex / batchProgress.totalCount) * 100;
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption">
            Processing {batchProgress.currentIndex} of {batchProgress.totalCount}
          </Typography>
          <Button
            data-testid="batch-stop-button"
            size="small"
            color="error"
            startIcon={<CancelIcon fontSize="small" />}
            onClick={onStop}
            sx={{ minWidth: 0, py: 0 }}
          >
            Stop
          </Button>
        </Box>
        <LinearProgress variant="determinate" value={value} />
        <Typography variant="caption" noWrap title={batchProgress.currentFilename}>
          {batchProgress.currentFilename}
        </Typography>
      </Box>
    );
  }

  if (pendingCount === 0 || isBusy) return null;

  return (
    <Button
      data-testid="analyze-all-button"
      variant="contained"
      fullWidth
      size="small"
      startIcon={<PlayCircleIcon fontSize="small" />}
      onClick={onAnalyzeAll}
    >
      Analyze All ({pendingCount})
    </Button>
  );
};
