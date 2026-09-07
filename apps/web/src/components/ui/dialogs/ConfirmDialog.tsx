import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

import { useDictionary } from '../../../i18n/use-dictionary.js';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  testId: string;
  onClose: () => void;
  onConfirm: () => void;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
  error?: string | null;
}

export const ConfirmDialog = ({
  open,
  title,
  body,
  confirmLabel,
  testId,
  onClose,
  onConfirm,
  destructive = true,
  disabled = false,
  busy = false,
  error = null,
}: ConfirmDialogProps) => {
  const dictionary = useDictionary();

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" data-testid={`${testId}-dialog`}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{body}</DialogContentText>
        {error === null ? null : (
          <Alert severity="error" sx={{ mt: 2 }} data-testid={`${testId}-error`}>{error}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={busy} data-testid={`${testId}-cancel`}>
          {dictionary.common.cancel}
        </Button>
        <Button
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          onClick={onConfirm}
          disabled={disabled || busy}
          data-testid={testId}
        >
          {busy ? <CircularProgress size={16} color="inherit" /> : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
