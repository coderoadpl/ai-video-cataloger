import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

interface DeleteModelDialogProps {
  open: boolean;
  modelName: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export const DeleteModelDialog = ({ open, modelName, onClose, onConfirm }: DeleteModelDialogProps) => (
  <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-testid="delete-model-dialog">
    <DialogTitle>Delete model</DialogTitle>
    <DialogContent>
      <DialogContentText>
        Delete the <strong>{modelName}</strong> Whisper model from disk? You can download it again
        later.
      </DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button color="inherit" onClick={onClose}>
        Cancel
      </Button>
      <Button color="error" variant="contained" onClick={onConfirm} data-testid="delete-model-confirm">
        Delete
      </Button>
    </DialogActions>
  </Dialog>
);
