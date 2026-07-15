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
  disabledReason?: string | undefined;
}

export const BatchToolbar = ({
  pendingCount,
  isBusy,
  batchProgress,
  onAnalyzeAll,
  onStop,
  disabledReason,
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Button
        data-testid="analyze-all-button"
        variant="contained"
        fullWidth
        size="small"
        disabled={disabledReason !== undefined}
        startIcon={<PlayCircleIcon fontSize="small" />}
        onClick={onAnalyzeAll}
      >
        Analyze All ({pendingCount})
      </Button>
      {disabledReason === undefined ? null : (
        <Typography variant="caption" color="text.secondary">{disabledReason}</Typography>
      )}
    </Box>
  );
};
