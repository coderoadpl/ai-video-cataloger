import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

export interface CancelConfirmation {
  open: boolean;
  isBatch: boolean;
}

interface CancelConfirmationDialogProps {
  confirmation: CancelConfirmation;
  onClose: () => void;
  onConfirm: () => void;
}

export const CancelConfirmationDialog = ({
  confirmation,
  onClose,
  onConfirm,
}: CancelConfirmationDialogProps) => (
  <Dialog open={confirmation.open} onClose={onClose} maxWidth="xs" fullWidth>
    <DialogTitle>
      {confirmation.isBatch ? 'Cancel Batch Processing?' : 'Cancel Processing?'}
    </DialogTitle>
    <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {confirmation.isBatch ? (
        <>
          <DialogContentText>
            Are you sure you want to cancel the batch analysis? This will stop after the current
            video finishes processing.
          </DialogContentText>
          <Alert severity="warning" icon={false}>
            The current video may be left in an incomplete state. Already processed videos will keep
            their results.
          </Alert>
        </>
      ) : (
        <>
          <DialogContentText>
            Are you sure you want to cancel the current video analysis?
          </DialogContentText>
          <Alert severity="warning" icon={false}>
            This may leave the video in an incomplete state. Partial data (extracted frames, audio,
            etc.) may remain and you may need to re-analyze the video from the beginning.
          </Alert>
        </>
      )}
    </DialogContent>
    <DialogActions>
      <Button color="inherit" onClick={onClose}>
        Continue Processing
      </Button>
      <Button
        data-testid="confirm-cancel-button"
        color="error"
        variant="contained"
        onClick={onConfirm}
      >
        {confirmation.isBatch ? 'Stop Batch' : 'Cancel Analysis'}
      </Button>
    </DialogActions>
  </Dialog>
);
