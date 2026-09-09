import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { AnalyzeScope } from '../../components/ui/ScopeAnalyzeToolbar.js';
import { flattenTreeVideos, followRenamedKey, keyOf } from './index.web.js';
import { useCatalog } from './use-catalog.js';
import { useCatalogTree } from './use-catalog-tree.js';
import { useCatalogVideoRegistry } from './use-catalog-video-registry.js';
import { useScopePreference } from './use-scope-preference.js';
import { useTreeScopeAvailability } from './use-tree-absent-files.js';

export const useCatalogWorkspace = (folder: string | null) => {
  const catalog = useCatalog(folder);
  const tree = useCatalogTree(folder);
  const videoRegistry = useCatalogVideoRegistry();
  const [scope, setScope] = useScopePreference(folder);
  const selectKey = catalog.selectKey;
  const selectedKeyRef = useRef(catalog.selectedKey);
  useEffect(() => {
    selectedKeyRef.current = catalog.selectedKey;
  }, [catalog.selectedKey]);
  const followRenamedSelection = useCallback(
    (oldPath: string, newPath: string) => {
      if (selectedKeyRef.current === oldPath) selectKey(newPath);
    },
    [selectKey],
  );
  const selected = useMemo(() => {
    if (catalog.selectedVideo !== null) return catalog.selectedVideo;
    if (catalog.selectedKey === null) return null;
    const fromTree = tree.root === null
      ? null
      : flattenTreeVideos(tree.root).find((video) => keyOf(video) === catalog.selectedKey) ?? null;
    return fromTree ?? videoRegistry.lookup(catalog.selectedKey);
  }, [catalog.selectedVideo, catalog.selectedKey, tree.root, videoRegistry]);

  const selectedSnapshotRef = useRef<{ path: string; contentHash: string | null } | null>(null);
  useEffect(() => {
    if (selected !== null) selectedSnapshotRef.current = { path: selected.path, contentHash: selected.contentHash };
  }, [selected]);
  useEffect(() => {
    const currentKey = catalog.selectedKey;
    if (currentKey === null) return;
    const freshVideos = tree.root === null ? catalog.videos : [...catalog.videos, ...flattenTreeVideos(tree.root)];
    if (freshVideos.some((video) => video.path === currentKey)) return;
    if (videoRegistry.lookup(currentKey) !== null) return;
    const followed = followRenamedKey(selectedSnapshotRef.current, freshVideos);
    if (followed !== null && followed !== currentKey) selectKey(followed);
  }, [catalog.videos, tree.root, catalog.selectedKey, selectKey, videoRegistry]);

  const subfolderVideoCount = useMemo(() => {
    const root = tree.root;
    if (root === null) return 0;
    return root.children.reduce((total, child) => total + (child.videoCount ?? child.videos.length), 0);
  }, [tree.root]);
  const treeScopeAvailable = useTreeScopeAvailability(folder, subfolderVideoCount);
  const effectiveScope: AnalyzeScope = treeScopeAvailable ? scope : 'folder';
  const showTree = effectiveScope === 'tree';
  const treePendingCount = Math.max(0, tree.videoTotal - tree.processedTotal);
  const treeCanAnalyze = tree.videoTotal > tree.processedTotal || tree.hasUnknownPending;
  return { catalog, tree, videoRegistry, selected, selectKey, followRenamedSelection, setScope,
    subfolderVideoCount, treeScopeAvailable, effectiveScope, showTree, treePendingCount, treeCanAnalyze };
};
