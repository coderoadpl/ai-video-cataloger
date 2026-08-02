import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

import { type AnalysisMedia, AnalysisMediaToggle } from '../../components/ui/AnalysisMediaToggle.js';
import { SidebarFolderPanel } from '../../components/ui/SidebarFolderPanel.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { AbsentFilesSection } from './AbsentFilesSection.js';
import { TreeAbsentFilesSection } from './TreeAbsentFilesSection.js';
import { CatalogTree } from './CatalogTree.js';
import { SidebarSkeleton } from './SidebarSkeleton.js';
import { type CatalogVideo } from './core/index.js';
import { type CatalogState } from './use-catalog.js';
import { type CatalogTreeState } from './use-catalog-tree.js';
import { VideoList } from './VideoList.js';

interface CatalogSidebarProps {
  folder: string | null;
  catalog: CatalogState;
  tree?: CatalogTreeState;
  showTree?: boolean;
  analyzingPath?: string | null;
  toolbar?: ReactNode;
  lockBanner?: ReactNode;
  registerVideos: (videos: readonly CatalogVideo[]) => void;
  subfolderVideoCount?: number;
  onSwitchToWholeTree?: (() => void) | undefined;
  recentFolders?: string[];
  isCheckingFolder?: boolean;
  onOpenFolder?: () => void;
  onSelectRecentFolder?: (folderPath: string) => void;
  onAnalysisMediaChange?: (media: AnalysisMedia) => void;
}

export const CatalogSidebar = ({
  folder,
  catalog,
  tree,
  showTree = true,
  analyzingPath = null,
  toolbar,
  lockBanner,
  registerVideos,
  subfolderVideoCount = 0,
  onSwitchToWholeTree,
  recentFolders = [],
  isCheckingFolder = false,
  onOpenFolder = () => undefined,
  onSelectRecentFolder = () => undefined,
  onAnalysisMediaChange = () => undefined,
}: CatalogSidebarProps) => {
  const dictionary = useDictionary();

  const header = (
    <>
      <SidebarFolderPanel
        folder={folder}
        recentFolders={recentFolders}
        isCheckingFolder={isCheckingFolder}
        onOpenFolder={onOpenFolder}
        onSelectRecentFolder={onSelectRecentFolder}
        emptyHint={(
          <>
            <Typography variant="body2" color="text.secondary">
              {dictionary.catalog.noFolderSelected}
            </Typography>
            <Typography variant="caption">{dictionary.catalog.openFolderHint}</Typography>
          </>
        )}
      />
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <AnalysisMediaToggle media="videos" onSelect={onAnalysisMediaChange} />
      </Box>
    </>
  );

  if (folder === null) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {header}
      </Box>
    );
  }

  const treeRoot = tree?.root ?? null;
  const useTree = showTree && tree !== undefined;
  const showTreeSkeleton = useTree
    && treeRoot === null
    && catalog.videos.length === 0
    && (tree.isLoading || catalog.isLoading);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {header}
      {catalog.isGeneratingThumbnails || lockBanner !== undefined || toolbar !== undefined ? (
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderBottom: 1,
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {catalog.isGeneratingThumbnails ? (
            <Typography variant="caption" sx={{ color: 'primary.main' }}>
              {dictionary.catalog.generatingThumbnails}
            </Typography>
          ) : null}
          {lockBanner === undefined ? null : lockBanner}
          {toolbar === undefined ? null : toolbar}
        </Box>
      ) : null}
      <Box sx={{ flex: 1, minHeight: 0, overflow: !useTree || treeRoot === null ? (showTreeSkeleton ? 'hidden' : 'auto') : 'hidden' }}>
        {showTreeSkeleton ? (
          <SidebarSkeleton />
        ) : !useTree || treeRoot === null ? (
          <>
            <VideoList
              videos={catalog.videos}
              selectedKey={catalog.selectedKey}
              analyzingPath={analyzingPath}
              isLoading={catalog.isLoading}
              isError={catalog.isError}
              error={catalog.error}
              onSelect={catalog.select}
              thumbnailFailedPaths={catalog.thumbnailFailedPaths}
              subfolderVideoCount={subfolderVideoCount}
              onSwitchToWholeTree={onSwitchToWholeTree}
            />
            <AbsentFilesSection folder={folder} />
          </>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <CatalogTree
                root={treeRoot}
                rootVideos={catalog.videos}
                selectedKey={catalog.selectedKey}
                analyzingPath={analyzingPath}
                thumbnailFailedPaths={catalog.thumbnailFailedPaths}
                onSelect={catalog.select}
                registerVideos={registerVideos}
              />
            </Box>
            <Box sx={{ flexShrink: 0, maxHeight: '40%', overflow: 'auto' }}>
              <TreeAbsentFilesSection root={treeRoot} />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
