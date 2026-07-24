import { actions } from '../../api.js';

import { createCatalogCore } from './core/index.js';

export { flattenTreeVideos, keyOf } from './core/index.js';
export type { CatalogTreeNode, CatalogVideo } from './core/index.js';

const core = createCatalogCore({ descriptors: { tree: actions.catalogTree } });

export const catalogTree = core.tree;
export const buildCatalogTree = core.buildTree;
