import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

import { FolderIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { folderName } from '../../lib/format.js';
import { AbsentFilesSection } from './AbsentFilesSection.js';
import { CatalogTree } from './CatalogTree.js';
import { SidebarSkeleton } from './SidebarSkeleton.js';
import { type CatalogVideo } from './catalog-video.js';
import { type CatalogState } from './use-catalog.js';
import { type CatalogTreeState } from './use-catalog-tree.js';
import { VideoList } from './VideoList.js';

const EMPTY_SKIPPED: ReadonlySet<string> = new Set();

interface CatalogSidebarProps {
  folder: string | null;
  catalog: CatalogState;
  tree?: CatalogTreeState;
  analyzingPath?: string | null;
  skippedPaths?: ReadonlySet<string>;
  toolbar?: ReactNode;
  lockBanner?: ReactNode;
  registerVideos: (videos: readonly CatalogVideo[]) => void;
}

export const CatalogSidebar = ({
  folder,
  catalog,
  tree,
  analyzingPath = null,
  skippedPaths = EMPTY_SKIPPED,
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
  const showTreeSkeleton = tree !== undefined && treeRoot === null && (tree.isLoading || catalog.isLoading);

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
      <Box sx={{ flex: 1, minHeight: 0, overflow: treeRoot === null && !showTreeSkeleton ? 'auto' : 'hidden' }}>
        {showTreeSkeleton ? (
          <SidebarSkeleton />
        ) : treeRoot === null ? (
          <>
            <VideoList
              videos={catalog.videos}
              selectedKey={catalog.selectedKey}
              analyzingPath={analyzingPath}
              isLoading={catalog.isLoading}
              isError={catalog.isError}
              error={catalog.error}
              onSelect={catalog.select}
              skippedPaths={skippedPaths}
            />
            <AbsentFilesSection folder={folder} />
          </>
        ) : (
          <CatalogTree
            root={treeRoot}
            rootVideos={catalog.videos}
            selectedKey={catalog.selectedKey}
            analyzingPath={analyzingPath}
            skippedPaths={skippedPaths}
            onSelect={catalog.select}
            registerVideos={registerVideos}
          />
        )}
      </Box>
    </Box>
  );
};
