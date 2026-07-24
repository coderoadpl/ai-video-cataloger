import type { ReactNode } from 'react';
import { Alert, Button } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { useDictionary } from '../../i18n/use-dictionary.js';

export interface CatalogLockUi {
  disabledReason: string | undefined;
  lockBanner: ReactNode | undefined;
}

export const useCatalogLock = (): CatalogLockUi => {
  const dictionary = useDictionary();
  const catalogLock = useQuery(actions.catalogLock);
  const catalogLockRetry = useMutation(actions.catalogLockRetry);
  const lockOwner = catalogLock.data?.blockedBy ?? null;
  if (lockOwner === null) return { disabledReason: undefined, lockBanner: undefined };
  const message = dictionary.catalog.lockedBy(lockOwner.processName, lockOwner.pid);
  return {
    disabledReason: message,
    lockBanner: (
      <Alert
        severity="warning"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              void catalogLockRetry
                .mutateAsync(undefined)
                .then(() => catalogLock.refetch())
                .catch(() => catalogLock.refetch());
            }}
          >
            {dictionary.catalog.retryLock}
          </Button>
        }
      >
        {message}
      </Alert>
    ),
  };
};
