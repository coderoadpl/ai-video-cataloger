import { useSyncExternalStore } from 'react';
import { Snackbar } from '@mui/material';

import { savedToastStore } from '../../lib/saved-toast.js';

export const SavedSnackbar = () => {
  const message = useSyncExternalStore(savedToastStore.subscribe, savedToastStore.snapshot);

  return (
    <Snackbar
      open={message !== null}
      autoHideDuration={2500}
      onClose={() => savedToastStore.dismiss()}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      message={message ?? ''}
      data-testid="saved-snackbar"
    />
  );
};
