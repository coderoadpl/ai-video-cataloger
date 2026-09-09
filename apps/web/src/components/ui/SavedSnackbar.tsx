import { Snackbar } from '@mui/material';

import { useSavedMessage } from './SavedToastProvider.js';

export const SavedSnackbar = () => {
  const { message, dismiss } = useSavedMessage();

  return (
    <Snackbar
      open={message !== null}
      autoHideDuration={2500}
      onClose={dismiss}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      message={message ?? ''}
      data-testid="saved-snackbar"
    />
  );
};
