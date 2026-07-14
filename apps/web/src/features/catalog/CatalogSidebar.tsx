import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

import { FolderIcon } from '../../components/ui/icons.js';
import { folderName } from '../../lib/format.js';
import { type CatalogState } from './use-catalog.js';
import { VideoList } from './VideoList.js';

interface CatalogSidebarProps {
  folder: string | null;
  catalog: CatalogState;
  analyzingPath?: string | null;
  toolbar?: ReactNode;
}

export const CatalogSidebar = ({
  folder,
  catalog,
  analyzingPath = null,
  toolbar,
}: CatalogSidebarProps) => {
  if (folder === null) {
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          No folder selected
        </Typography>
        <Typography variant="caption">Open a folder to catalog its videos.</Typography>
      </Box>
    );
  }

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
            Generating thumbnails…
          </Typography>
        ) : null}
        {toolbar === undefined ? null : <Box sx={{ mt: 1 }}>{toolbar}</Box>}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <VideoList
          videos={catalog.videos}
          selectedKey={catalog.selectedKey}
          analyzingPath={analyzingPath}
          isLoading={catalog.isLoading}
          isError={catalog.isError}
          error={catalog.error}
          onSelect={catalog.select}
        />
      </Box>
    </Box>
  );
};
