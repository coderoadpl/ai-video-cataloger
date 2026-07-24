import { buildCatalogTree, type CatalogTreeData, type CatalogTreeNode } from './catalog-tree-model.js';

export { buildCatalogTree, flattenTreeVideos } from './catalog-tree-model.js';
export type { CatalogTreeData, CatalogTreeNode } from './catalog-tree-model.js';
export { buildTreeRows, countsFromVideos, folderNeedsFetch } from './catalog-tree-rows.js';
export type {
  BuildTreeRowsInput,
  FolderCountsData,
  FolderRow,
  LoadedFolder,
  StatusRow,
  TreeRow,
  VideoRow,
} from './catalog-tree-rows.js';
export { keyOf } from './catalog-video.js';
export type { CatalogVideo } from './catalog-video.js';

export interface CatalogCoreDeps<TTree> {
  readonly descriptors: { readonly tree: TTree };
}

export interface CatalogCore<TTree> {
  readonly tree: TTree;
  buildTree(data: CatalogTreeData): CatalogTreeNode;
}

export const createCatalogCore = <TTree>(deps: CatalogCoreDeps<TTree>): CatalogCore<TTree> => ({
  tree: deps.descriptors.tree,
  buildTree: buildCatalogTree,
});
