import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

import { FolderIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { folderName } from '../../lib/format.js';
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
}: CatalogSidebarProps) => {
  const dictionary = useDictionary();

  if (folder === null) {
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {dictionary.catalog.noFolderSelected}
        </Typography>
        <Typography variant="caption">{dictionary.catalog.openFolderHint}</Typography>
      </Box>
    );
  }

  const treeRoot = tree?.root ?? null;
  const useTree = showTree && tree !== undefined;
  const showTreeSkeleton = useTree && treeRoot === null && (tree.isLoading || catalog.isLoading);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />
          <Typography variant="h2" noWrap title={folder}>
            {folderName(folder)}
          </Typography>
        </Box>
        <Typography variant="caption" noWrap title={folder}>
          {folder}
        </Typography>
        {catalog.isGeneratingThumbnails ? (
          <Typography variant="caption" sx={{ color: 'primary.main' }}>
            {dictionary.catalog.generatingThumbnails}
          </Typography>
        ) : null}
        {lockBanner === undefined ? null : <Box sx={{ mt: 1 }}>{lockBanner}</Box>}
        {toolbar === undefined ? null : <Box sx={{ mt: 1 }}>{toolbar}</Box>}
      </Box>
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
