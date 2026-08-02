import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { ApiError } from '@core/client/index.js';
import type { catalogFolderOutputSchema } from '@core/contract/index.js';

import { actions } from '../../api.js';

export type AbsentFileEntry = z.output<typeof catalogFolderOutputSchema>['records'][number];

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export interface AbsentFilesState {
  entries: AbsentFileEntry[];
  isForgetting: boolean;
  error: string | null;
  forget: (fingerprint: string) => Promise<boolean>;
}

export const useAbsentFiles = (folder: string): AbsentFilesState => {
  const queryClient = useQueryClient();
  const query = useQuery({ ...actions.catalogFolder({ folder }) });
  const forgetMutation = useMutation(actions.indexForget);
  const [error, setError] = useState<string | null>(null);

  const entries = (query.data?.records ?? []).filter((record) => record.missing);

  const forget = useCallback(
    async (fingerprint: string): Promise<boolean> => {
      setError(null);
      try {
        await forgetMutation.mutateAsync({ fingerprint });
        await queryClient.invalidateQueries();
        return true;
      } catch (caught) {
        setError(messageOf(caught));
        return false;
      }
    },
    [forgetMutation, queryClient],
  );

  return { entries, isForgetting: forgetMutation.isPending, error, forget };
};
