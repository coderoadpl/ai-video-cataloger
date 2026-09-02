import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatArchiveSize, type RemoteBackupView } from './backup-model.js';

interface BackupRestoreDialogProps {
  backup: RemoteBackupView | null;
  phase: string | null;
  isRestoring: boolean;
  error: string | null;
  onConfirm: (remoteId: string) => void;
  onClose: () => void;
}

export const BackupRestoreDialog = ({
  backup,
  phase,
  isRestoring,
  error,
  onConfirm,
  onClose,
}: BackupRestoreDialogProps) => {
  const dictionary = useDictionary();
  const [armed, setArmed] = useState(false);
  const running = isRestoring && error === null;

  const close = () => {
    setArmed(false);
    onClose();
  };

  return (
    <Dialog
      open={backup !== null}
      onClose={running ? undefined : close}
      fullWidth
      maxWidth="sm"
      data-testid="backup-restore-dialog"
    >
      <DialogTitle>{dictionary.backup.restoreDialogTitle}</DialogTitle>
      <DialogContent dividers>
        {backup === null ? null : (
          <Typography variant="body2" sx={{ mb: 1.5 }} data-testid="backup-restore-target">
            {dictionary.backup.backupRow(backup.createdAt, formatArchiveSize(backup.sizeBytes), backup.appVersion)}
          </Typography>
        )}
        <DialogContentText>{dictionary.backup.restoreDialogOverwrite}</DialogContentText>
        <DialogContentText>{dictionary.backup.restoreDialogPreRestore}</DialogContentText>
        <DialogContentText>{dictionary.backup.restoreDialogRelaunch}</DialogContentText>
        {running && phase !== null ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }} data-testid="backup-restore-progress">
            <CircularProgress size={16} />
            <Typography variant="body2">{dictionary.backup.restoreRunning(phase)}</Typography>
          </Box>
        ) : null}
        {error === null ? null : (
          <Alert severity="error" sx={{ mt: 2 }} data-testid="backup-restore-error">
            {`${error} ${dictionary.backup.restoreFailedNothingChanged}`}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={close} disabled={running} data-testid="backup-restore-cancel">
          {dictionary.common.cancel}
        </Button>
        {armed ? (
          <Button
            variant="contained"
            color="warning"
            disabled={backup === null || running}
            onClick={() => {
              if (backup !== null) onConfirm(backup.remoteId);
            }}
            data-testid="backup-restore-confirm-final"
          >
            {dictionary.backup.restoreConfirmAgain}
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={backup === null || running}
            onClick={() => setArmed(true)}
            data-testid="backup-restore-confirm"
          >
            {dictionary.backup.restoreConfirm}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
