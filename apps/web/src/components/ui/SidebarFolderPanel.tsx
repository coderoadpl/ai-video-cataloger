import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

import { folderName } from '../../lib/format.js';
import { FolderBar } from './FolderBar.js';
import { FolderIcon } from './icons.js';

interface SidebarFolderPanelProps {
  folder: string | null;
  recentFolders: string[];
  isCheckingFolder: boolean;
  onOpenFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
  onClearRecentFolders?: (() => void) | undefined;
  emptyHint?: ReactNode;
}

export const SidebarFolderPanel = ({
  folder,
  recentFolders,
  isCheckingFolder,
  onOpenFolder,
  onSelectRecentFolder,
  onClearRecentFolders,
  emptyHint,
}: SidebarFolderPanelProps) => (
  <Box
    data-testid="sidebar-folder-panel"
    sx={{
      px: 2,
      py: 1.25,
      borderBottom: 1,
      borderColor: 'divider',
      display: 'flex',
      flexDirection: 'column',
      gap: 0.75,
    }}
  >
    <FolderBar
      recentFolders={recentFolders}
      isCheckingFolder={isCheckingFolder}
      onOpenFolder={onOpenFolder}
      onSelectRecentFolder={onSelectRecentFolder}
      onClearRecentFolders={onClearRecentFolders}
      fullWidth
    />
    {folder === null ? (
      emptyHint === undefined ? null : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>{emptyHint}</Box>
      )
    ) : (
      <Box data-testid="sidebar-folder-identity" sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />
          <Typography variant="h2" noWrap title={folder} sx={{ flex: 1, minWidth: 0 }}>
            {folderName(folder)}
          </Typography>
        </Box>
        <Typography variant="caption" noWrap title={folder}>
          {folder}
        </Typography>
      </Box>
    )}
  </Box>
);
