export interface PhotoTreeFolderData {
  path: string;
  name: string;
  relativePath: string;
  root: string;
  depth: number;
  photoCount: number;
  analysedCount: number;
}

export interface PhotoTreeNode {
  path: string;
  name: string;
  relativePath: string;
  root: string;
  depth: number;
  directPhotoCount: number;
  directAnalysedCount: number;
  photoCount: number;
  analysedCount: number;
  children: PhotoTreeNode[];
}

interface MutableNode {
  path: string;
  name: string;
  relativePath: string;
  root: string;
  depth: number;
  directPhotoCount: number;
  directAnalysedCount: number;
  children: MutableNode[];
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const joinPath = (root: string, relativePath: string): string => `${root.replace(/\/+$/, '')}/${relativePath}`;

const finalize = (node: MutableNode): PhotoTreeNode => {
  const children = node.children
    .slice()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map(finalize);
  return {
    path: node.path,
    name: node.name,
    relativePath: node.relativePath,
    root: node.root,
    depth: node.depth,
    directPhotoCount: node.directPhotoCount,
    directAnalysedCount: node.directAnalysedCount,
    photoCount: children.reduce((sum, child) => sum + child.photoCount, node.directPhotoCount),
    analysedCount: children.reduce((sum, child) => sum + child.analysedCount, node.directAnalysedCount),
    children,
  };
};

const buildRootTree = (root: string, folders: readonly PhotoTreeFolderData[]): PhotoTreeNode => {
  const rootName = basename(root);
  const nodes = new Map<string, MutableNode>();

  const ensure = (relativePath: string): MutableNode => {
    const existing = nodes.get(relativePath);
    if (existing !== undefined) return existing;
    const segments = relativePath === '' ? [] : relativePath.split('/');
    const node: MutableNode = {
      path: relativePath === '' ? root : joinPath(root, relativePath),
      name: relativePath === '' ? rootName : segments[segments.length - 1] ?? rootName,
      relativePath,
      root,
      depth: segments.length,
      directPhotoCount: 0,
      directAnalysedCount: 0,
      children: [],
    };
    nodes.set(relativePath, node);
    if (relativePath !== '') ensure(segments.slice(0, -1).join('/')).children.push(node);
    return node;
  };

  const rootNode = ensure('');
  for (const folder of folders) {
    const node = ensure(folder.relativePath);
    node.directPhotoCount = folder.photoCount;
    node.directAnalysedCount = folder.analysedCount;
  }
  return finalize(rootNode);
};

export const buildPhotoTrees = (folders: readonly PhotoTreeFolderData[]): PhotoTreeNode[] => {
  const byRoot = new Map<string, PhotoTreeFolderData[]>();
  for (const folder of folders) {
    const bucket = byRoot.get(folder.root) ?? [];
    bucket.push(folder);
    byRoot.set(folder.root, bucket);
  }
  return [...byRoot.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map((root) => buildRootTree(root, byRoot.get(root) ?? []));
};
