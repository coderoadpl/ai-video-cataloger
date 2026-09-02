import { Box, Button, CircularProgress, Tooltip, Typography } from '@mui/material';

import type { BackupIndicatorState } from '@core/domain/index.js';

import { CheckCircleIcon, WarningIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { phaseLabel, useBackupStatus } from './use-backup.js';

export interface BackupIndicatorViewProps {
  state: BackupIndicatorState;
  phase: string | null;
  lastSuccessAt: string | null;
  onOpenSettings: () => void;
}

export const BackupIndicatorView = ({ state, phase, lastSuccessAt, onOpenSettings }: BackupIndicatorViewProps) => {
  const dictionary = useDictionary();
  if (state === 'disabled') return null;

  if (state === 'running') {
    return (
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, maxWidth: 160, color: 'grey.400' }}
        data-testid="backup-indicator"
        data-state="running"
      >
        <CircularProgress size={16} thickness={6} color="inherit" />
        <Typography variant="caption" noWrap>{phase ?? dictionary.backup.indicatorLabel}</Typography>
      </Box>
    );
  }

  if (state === 'failed') {
    return (
      <Tooltip title={dictionary.backup.indicatorFailed}>
        <Button
          size="small"
          onClick={onOpenSettings}
          sx={{ color: 'warning.main', minWidth: 0, maxWidth: 160 }}
          data-testid="backup-indicator"
          data-state="failed"
          aria-label={dictionary.backup.indicatorLabel}
        >
          <WarningIcon fontSize="small" />
        </Button>
      </Tooltip>
    );
  }

  return (
    <Tooltip
      title={lastSuccessAt === null
        ? dictionary.backup.lastBackupNever
        : dictionary.backup.indicatorIdle(lastSuccessAt)}
    >
      <Box
        sx={{ display: 'flex', alignItems: 'center', color: 'grey.400', maxWidth: 160, px: 0.5 }}
        data-testid="backup-indicator"
        data-state="idle"
        aria-label={dictionary.backup.indicatorLabel}
      >
        <CheckCircleIcon fontSize="small" />
      </Box>
    </Tooltip>
  );
};

export const BackupIndicator = ({ onOpenSettings }: { onOpenSettings: () => void }) => {
  const dictionary = useDictionary();
  const status = useBackupStatus().data;
  if (status === undefined) return null;
  return (
    <BackupIndicatorView
      state={status.indicator}
      phase={phaseLabel(status.phase, dictionary)}
      lastSuccessAt={status.lastSuccessAt}
      onOpenSettings={onOpenSettings}
    />
  );
};
