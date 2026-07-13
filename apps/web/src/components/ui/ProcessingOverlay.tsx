import { Box, Button, CircularProgress, LinearProgress, Typography } from '@mui/material';

import { CancelIcon } from './icons.js';

export interface ProgressView {
  step: string;
  stepLabel: string;
  percentage: number;
  stepNumber: number;
  totalSteps: number;
}

interface ProcessingOverlayProps {
  progress: ProgressView;
  onCancel: () => void;
}

/**
 * The details-panel progress overlay shown while the selected video is being
 * analyzed (parity-inventory §2): the human step label, the step number, the
 * percentage, a determinate progress bar and a Cancel button. Driven entirely
 * by the polled job progress.
 */
export const ProcessingOverlay = ({ progress, onCancel }: ProcessingOverlayProps) => (
  <Box
    data-testid="processing-overlay"
    sx={{
      px: 3,
      py: 1.5,
      borderBottom: 1,
      borderColor: 'divider',
      bgcolor: 'background.paper',
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
    }}
  >
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
          {progress.stepLabel}
        </Typography>
        <Typography variant="caption">
          (Step {progress.stepNumber} of {progress.totalSteps})
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main' }}>
          {progress.percentage}%
        </Typography>
        <Button
          data-testid="cancel-analysis-button"
          size="small"
          color="error"
          variant="outlined"
          startIcon={<CancelIcon fontSize="small" />}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </Box>
    </Box>
    <LinearProgress variant="determinate" value={progress.percentage} />
  </Box>
);
