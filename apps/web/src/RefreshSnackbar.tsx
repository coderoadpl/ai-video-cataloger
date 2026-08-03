import { useSyncExternalStore } from 'react';
import { Snackbar } from '@mui/material';

import { useDictionary } from './i18n/use-dictionary.js';
import { formatAnalyzerError } from './lib/analyzer-error-message.js';
import { refreshToastStore } from './refresh-toast.js';

export const RefreshSnackbar = () => {
  const toast = useSyncExternalStore(refreshToastStore.subscribe, refreshToastStore.snapshot);
  const dictionary = useDictionary();

  return (
    <Snackbar
      open={toast !== null}
      autoHideDuration={6000}
      onClose={() => refreshToastStore.dismiss()}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      message={
        toast === null ? '' : `couldn't refresh — ${formatAnalyzerError(toast.message, dictionary.errors)}`
      }
    />
  );
};
