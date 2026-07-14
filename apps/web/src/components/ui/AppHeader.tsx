import { Box, Button, Typography } from '@mui/material';

import { versionLabel } from '../../lib/format.js';
import { FolderBar } from './FolderBar.js';

interface AppHeaderProps {
  appVersion: string;
  recentFolders: string[];
  isCheckingFolder: boolean;
  onOpenFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
  onShowSettings: () => void;
  onShowModelManager: () => void;
  onShowPrerequisites: () => void;
}

export const AppHeader = ({
  appVersion,
  recentFolders,
  isCheckingFolder,
  onOpenFolder,
  onSelectRecentFolder,
  onShowSettings,
  onShowModelManager,
  onShowPrerequisites,
}: AppHeaderProps) => (
  <Box
    component="header"
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1.5,
      px: 3,
      py: 1.25,
      bgcolor: 'background.paper',
      borderBottom: 1,
      borderColor: 'divider',
    }}
  >
    <Typography variant="h1">AI Video Cataloger</Typography>
    {appVersion.length === 0 ? null : (
      <Typography variant="caption">{versionLabel(appVersion)}</Typography>
    )}
    <Box sx={{ flex: 1 }} />
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FolderBar
        recentFolders={recentFolders}
        isCheckingFolder={isCheckingFolder}
        onOpenFolder={onOpenFolder}
        onSelectRecentFolder={onSelectRecentFolder}
      />
      <Button variant="outlined" size="small" color="inherit" onClick={onShowSettings}>
        Settings
      </Button>
      <Button variant="outlined" size="small" color="inherit" onClick={onShowModelManager}>
        Models
      </Button>
      <Button variant="text" size="small" color="inherit" onClick={onShowPrerequisites}>
        Prerequisites
      </Button>
    </Box>
  </Box>
);
