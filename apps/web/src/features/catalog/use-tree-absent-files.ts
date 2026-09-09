import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { invalidateAffected } from '../../api-invalidation.js';
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
  error: string | null;
  forget: (fingerprint: string) => Promise<boolean>;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

// Without this the whole-tree scope is gated on files that are still on disk, so a subtree whose
// videos are all gone hides the only place the catalog offers to forget them.
export const useTreeScopeAvailability = (root: string | null, subfolderVideoCount: number): boolean => {
  const probeRoot = subfolderVideoCount > 0 ? null : root;
  const query = useQuery({
    ...actions.catalogTreeAbsent({ folder: probeRoot ?? ' ' }),
    enabled: probeRoot !== null,
  });
  if (subfolderVideoCount > 0) return true;
  return (query.data?.groups ?? []).some((group) => group.entries.length > 0);
};

export const useTreeAbsentFiles = (root: string | null, enabled: boolean): TreeAbsentFilesState => {
  const queryClient = useQueryClient();
  const forgetMutation = useMutation(actions.indexForget);
  const [error, setError] = useState<string | null>(null);
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
    async (fingerprint: string): Promise<boolean> => {
      setError(null);
      try {
        await forgetMutation.mutateAsync({ fingerprint });
        await invalidateAffected(queryClient, 'catalog');
        return true;
      } catch (caught) {
        setError(messageOf(caught));
        return false;
      }
    },
    [forgetMutation, queryClient],
  );

  return { groups, total, isForgetting: forgetMutation.isPending, error, forget };
};
