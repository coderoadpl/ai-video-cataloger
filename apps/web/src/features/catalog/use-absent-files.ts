import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import type { catalogFolderOutputSchema } from '@core/contract/index.js';

import { actions } from '../../api.js';

export type AbsentFileEntry = z.output<typeof catalogFolderOutputSchema>['records'][number];

export interface AbsentFilesState {
  entries: AbsentFileEntry[];
  isForgetting: boolean;
  forget: (fingerprint: string) => void;
}

export const useAbsentFiles = (folder: string): AbsentFilesState => {
  const queryClient = useQueryClient();
  const query = useQuery({ ...actions.catalogFolder({ folder }) });
  const forgetMutation = useMutation(actions.indexForget);

  const entries = (query.data?.records ?? []).filter((record) => record.missing);

  const forget = useCallback(
    (fingerprint: string) => {
      void (async () => {
        await forgetMutation.mutateAsync({ fingerprint });
        await queryClient.invalidateQueries();
      })();
    },
    [forgetMutation, queryClient],
  );

  return { entries, isForgetting: forgetMutation.isPending, forget };
};
