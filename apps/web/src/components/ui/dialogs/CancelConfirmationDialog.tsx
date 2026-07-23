import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

import { useDictionary } from '../../../i18n/use-dictionary.js';

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
}: CancelConfirmationDialogProps) => {
  const dictionary = useDictionary();

  return (
    <Dialog open={confirmation.open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {confirmation.isBatch ? dictionary.cancelDialog.batchTitle : dictionary.cancelDialog.singleTitle}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {confirmation.isBatch ? (
          <>
            <DialogContentText>{dictionary.cancelDialog.batchBody}</DialogContentText>
            <Alert severity="warning" icon={false}>
              {dictionary.cancelDialog.batchAlert}
            </Alert>
          </>
        ) : (
          <>
            <DialogContentText>{dictionary.cancelDialog.singleBody}</DialogContentText>
            <Alert severity="warning" icon={false}>
              {dictionary.cancelDialog.singleAlert}
            </Alert>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          {dictionary.cancelDialog.continueProcessing}
        </Button>
        <Button
          data-testid="confirm-cancel-button"
          color="error"
          variant="contained"
          onClick={onConfirm}
        >
          {confirmation.isBatch ? dictionary.cancelDialog.stopBatch : dictionary.cancelDialog.cancelAnalysis}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
