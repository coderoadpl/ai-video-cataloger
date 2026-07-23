import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

interface DeleteModelDialogProps {
  open: boolean;
  modelName: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export const DeleteModelDialog = ({ open, modelName, onClose, onConfirm }: DeleteModelDialogProps) => {
  const dictionary = useDictionary();

  return (
  <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-testid="delete-model-dialog">
    <DialogTitle>{dictionary.models.deleteModelTitle}</DialogTitle>
    <DialogContent>
      <DialogContentText>
        {dictionary.models.deleteModelText(modelName)}
      </DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button color="inherit" onClick={onClose}>
        {dictionary.common.cancel}
      </Button>
      <Button color="error" variant="contained" onClick={onConfirm} data-testid="delete-model-confirm">
        {dictionary.models.delete}
      </Button>
    </DialogActions>
  </Dialog>
  );
};
