import { useCallback } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { type CatalogTreeNode } from './catalog-tree-model.js';
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

export const collectFolderPaths = (root: CatalogTreeNode | null): string[] => {
  if (root === null) return [];
  const paths: string[] = [];
  const visit = (node: CatalogTreeNode): void => {
    paths.push(node.path);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return paths;
};

export const useTreeAbsentFiles = (folders: readonly string[]): TreeAbsentFilesState => {
  const queryClient = useQueryClient();
  const forgetMutation = useMutation(actions.indexForget);
  const results = useQueries({
    queries: folders.map((folder) => ({ ...actions.catalogFolder({ folder }) })),
  });

  const groups: AbsentFolderGroup[] = [];
  results.forEach((result, index) => {
    const folder = folders[index];
    if (folder === undefined) return;
    const entries = (result.data?.records ?? []).filter((record) => record.missing);
    if (entries.length > 0) groups.push({ folder, entries });
  });
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
