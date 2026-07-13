import { useRef, useState } from 'react';
import { Box, Button, ButtonGroup, Menu, MenuItem, Typography } from '@mui/material';

import { folderName } from '../../lib/format.js';

interface FolderBarProps {
  recentFolders: string[];
  isCheckingFolder: boolean;
  onOpenFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
}

/**
 * Split button: the left half opens the native folder picker, the right half
 * drops down the recent-folders list (basename over full path). Mirrors the old
 * renderer's folder bar.
 */
export const FolderBar = ({
  recentFolders,
  isCheckingFolder,
  onOpenFolder,
  onSelectRecentFolder,
}: FolderBarProps) => {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const select = (folderPath: string) => {
    setOpen(false);
    onSelectRecentFolder(folderPath);
  };

  return (
    <Box>
      <ButtonGroup ref={anchorRef} variant="contained" size="small" disableElevation>
        <Button onClick={onOpenFolder} disabled={isCheckingFolder}>
          {isCheckingFolder ? 'Checking…' : 'Open Folder'}
        </Button>
        <Button
          size="small"
          aria-label="recent folders"
          aria-haspopup="menu"
          disabled={recentFolders.length === 0}
          onClick={() => setOpen(true)}
          sx={{ px: 1, minWidth: 0 }}
        >
          ▾
        </Button>
      </ButtonGroup>
      <Menu
        anchorEl={anchorRef.current}
        open={open}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {recentFolders.map((folderPath) => (
          <MenuItem key={folderPath} onClick={() => select(folderPath)} sx={{ maxWidth: 360 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {folderName(folderPath)}
              </Typography>
              <Typography variant="caption" noWrap sx={{ display: 'block' }}>
                {folderPath}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};
