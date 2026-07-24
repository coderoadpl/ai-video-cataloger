import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { buildCatalogTree, type CatalogTreeNode } from './catalog-tree-model.js';

const TREE_DISABLED_FOLDER = ' ';

export interface CatalogTreeState {
  root: CatalogTreeNode | null;
  pendingTotal: number;
  processedTotal: number;
  videoTotal: number;
  hasUnknownPending: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export const useCatalogTree = (folder: string | null): CatalogTreeState => {
  const tree = useQuery({
    ...actions.catalogTree({ folder: folder ?? TREE_DISABLED_FOLDER }),
    enabled: folder !== null,
  });

  const root = useMemo(
    () => (tree.data === undefined ? null : buildCatalogTree(tree.data)),
    [tree.data],
  );

  return {
    root,
    pendingTotal: tree.data?.pendingTotal ?? 0,
    processedTotal: tree.data?.processedTotal ?? 0,
    videoTotal: tree.data?.videoTotal ?? 0,
    hasUnknownPending: tree.data?.hasUnknownPending ?? false,
    isLoading: tree.isLoading,
    isError: tree.isError,
    error: tree.error,
  };
};
