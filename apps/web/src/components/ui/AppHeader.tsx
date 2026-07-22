import { Box, Button, InputAdornment, TextField, Typography } from '@mui/material';

import { versionLabel } from '../../lib/format.js';
import { FolderBar } from './FolderBar.js';
import { SearchIcon } from './icons.js';

interface AppHeaderProps {
  appVersion: string;
  recentFolders: string[];
  isCheckingFolder: boolean;
  onOpenFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
  onShowSettings: () => void;
  onShowModelManager: () => void;
  onShowPrerequisites: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
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
  searchQuery,
  onSearchQueryChange,
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
    <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 180 }}>
      <TextField
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder="Search catalog"
        size="small"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        sx={{ width: { xs: 220, md: 360 }, maxWidth: '100%' }}
      />
    </Box>
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
