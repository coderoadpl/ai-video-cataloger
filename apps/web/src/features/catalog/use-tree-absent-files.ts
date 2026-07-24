import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { type AbsentFileEntry } from './use-absent-files.js';

export interface AbsentFolderGroup {
  folder: string;
  entries: AbsentFileEntry[];
}

export interface TreeAbsentFilesState {
  groups: AbsentFolderGroup[];
  total: number;
  isForgetting: boolean;
  forget: (fingerprint: string) => void;
}

export const useTreeAbsentFiles = (root: string | null, enabled: boolean): TreeAbsentFilesState => {
  const queryClient = useQueryClient();
  const forgetMutation = useMutation(actions.indexForget);
  const query = useQuery({
    ...actions.catalogTreeAbsent({ folder: root ?? ' ' }),
    enabled: enabled && root !== null,
  });

  const groups: AbsentFolderGroup[] = (query.data?.groups ?? []).map((group) => ({
    folder: group.folderPath,
    entries: group.entries,
  }));
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);

  const forget = useCallback(
    (fingerprint: string) => {
      void (async () => {
        await forgetMutation.mutateAsync({ fingerprint });
        await queryClient.invalidateQueries();
      })();
    },
    [forgetMutation, queryClient],
  );

  return { groups, total, isForgetting: forgetMutation.isPending, forget };
};
