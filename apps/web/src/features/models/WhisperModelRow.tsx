import { Box, Button, Chip, CircularProgress, LinearProgress, Typography } from '@mui/material';

import { CheckCircleIcon } from '../../components/ui/icons.js';
import type { WhisperModelEntry } from './models-model.js';

interface WhisperModelRowProps {
  model: WhisperModelEntry;
  activating: boolean;
  deleting: boolean;
  downloadPercentage: number | null;
  disabled: boolean;
  onActivate: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

/**
 * A single Whisper model row in the Model Manager (parity-inventory §2): status
 * icon, Active badge, download button with inline progress, delete button, and
 * click-to-activate on a downloaded, non-active model.
 */
export const WhisperModelRow = ({
  model,
  activating,
  deleting,
  downloadPercentage,
  disabled,
  onActivate,
  onDownload,
  onDelete,
}: WhisperModelRowProps) => {
  const clickable = model.downloaded && !model.active && !disabled;
  const isDownloading = downloadPercentage !== null;

  return (
    <Box
      data-testid="whisper-model-row"
      data-model-name={model.name}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onActivate : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        p: 1.5,
        borderRadius: 1,
        border: 1,
        borderColor: model.active ? 'primary.main' : 'divider',
        bgcolor: 'background.paper',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        {activating ? (
          <CircularProgress size={18} />
        ) : model.downloaded ? (
          <CheckCircleIcon fontSize="small" sx={{ color: 'status.completed.main' }} />
        ) : (
          <Box sx={{ width: 18, height: 18, borderRadius: '50%', border: 2, borderColor: 'divider' }} />
        )}
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
              {model.name}
            </Typography>
            {model.active ? <Chip size="small" color="primary" label="Active" /> : null}
          </Box>
          <Typography variant="caption">
            {model.size} ·{' '}
            {model.downloaded
              ? model.active
                ? 'Downloaded'
                : 'Click to activate'
              : 'Not downloaded'}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        {isDownloading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: 150 }} data-testid="whisper-download-progress">
            <LinearProgress variant="determinate" value={downloadPercentage} sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ width: 34, textAlign: 'right' }}>
              {downloadPercentage}%
            </Typography>
          </Box>
        ) : model.downloaded ? (
          <Button
            size="small"
            color="inherit"
            disabled={disabled}
            data-testid="whisper-delete-button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            {deleting ? <CircularProgress size={16} /> : 'Delete'}
          </Button>
        ) : (
          <Button
            size="small"
            variant="outlined"
            disabled={disabled}
            data-testid="whisper-download-button"
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
          >
            Download
          </Button>
        )}
      </Box>
    </Box>
  );
};
