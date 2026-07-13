import { useSyncExternalStore } from 'react';
import { Snackbar } from '@mui/material';

import { refreshToastStore } from './refresh-toast.js';

/** Renders the QueryCache refresh-failure notice while stale data stays on screen. */
export const RefreshSnackbar = () => {
  const toast = useSyncExternalStore(refreshToastStore.subscribe, refreshToastStore.snapshot);

  return (
    <Snackbar
      open={toast !== null}
      autoHideDuration={6000}
      onClose={() => refreshToastStore.dismiss()}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      message={toast === null ? '' : `couldn't refresh — ${toast.message}`}
    />
  );
};
