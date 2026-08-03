import { Box, Button, LinearProgress, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { type BatchProgressView } from './BatchToolbar.js';
import { CancelIcon, PlayCircleIcon } from './icons.js';

export type AnalyzeScope = 'folder' | 'tree';

interface ScopeAnalyzeToolbarProps {
  pendingCount: number;
  isBusy: boolean;
  progress: BatchProgressView | null;
  batchWait?: { requestCount: number } | null | undefined;
  onAnalyze: () => void;
  onStop: () => void;
  disabledReason?: string | undefined;
  approximateCount?: boolean;
  canAnalyze?: boolean | undefined;
}

export const ScopeAnalyzeToolbar = ({
  pendingCount,
  isBusy,
  progress,
  batchWait,
  onAnalyze,
  onStop,
  disabledReason,
  approximateCount = false,
  canAnalyze,
}: ScopeAnalyzeToolbarProps) => {
  const dictionary = useDictionary();
  const showAnalyze = canAnalyze ?? pendingCount > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {batchWait !== null && batchWait !== undefined ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }} data-testid="batch-wait">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption">
              {dictionary.processing.driveBatchWaiting(batchWait.requestCount)}
            </Typography>
            <Button
              data-testid="analyze-stop-button"
              size="small"
              color="error"
              startIcon={<CancelIcon fontSize="small" />}
              onClick={onStop}
              sx={{ minWidth: 0, py: 0 }}
            >
              {dictionary.batchToolbar.stop}
            </Button>
          </Box>
          <LinearProgress variant="indeterminate" />
          <Typography variant="caption" color="text.secondary">
            {dictionary.batchToolbar.batchWaitHint}
          </Typography>
        </Box>
      ) : progress !== null ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption">
              {dictionary.batchToolbar.processingCount(progress.currentIndex, progress.totalCount)}
            </Typography>
            <Button
              data-testid="analyze-stop-button"
              size="small"
              color="error"
              startIcon={<CancelIcon fontSize="small" />}
              onClick={onStop}
              sx={{ minWidth: 0, py: 0 }}
            >
              {dictionary.batchToolbar.stop}
            </Button>
          </Box>
          <LinearProgress
            variant={progress.totalCount > 0 ? 'determinate' : 'indeterminate'}
            value={progress.totalCount > 0 ? (progress.currentIndex / progress.totalCount) * 100 : 0}
          />
          <Typography variant="caption" noWrap title={progress.currentFilename}>
            {progress.currentFilename}
          </Typography>
        </Box>
      ) : isBusy || !showAnalyze ? null : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Button
            data-testid="analyze-all-button"
            variant="contained"
            fullWidth
            size="small"
            disabled={disabledReason !== undefined}
            startIcon={<PlayCircleIcon fontSize="small" />}
            onClick={onAnalyze}
          >
            {approximateCount
              ? dictionary.batchToolbar.analyzeUpTo(pendingCount)
              : dictionary.batchToolbar.analyzeAll(pendingCount)}
          </Button>
          {disabledReason === undefined ? null : (
            <Typography variant="caption" color="text.secondary">
              {disabledReason}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
};
