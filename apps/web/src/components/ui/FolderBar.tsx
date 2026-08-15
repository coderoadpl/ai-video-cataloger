import { useRef, useState } from 'react';
import { Box, Button, ButtonGroup, Divider, Menu, MenuItem, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { folderName } from '../../lib/format.js';

interface FolderBarProps {
  recentFolders: string[];
  isCheckingFolder: boolean;
  onOpenFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
  onClearRecentFolders?: (() => void) | undefined;
  secondaryAction?: { label: string; onSelect: () => void; disabled?: boolean } | undefined;
  fullWidth?: boolean;
}

const dedupeFolders = (folders: readonly string[]): string[] => [...new Set(folders)];

const dropdownSegmentSx = { px: 1, minWidth: 0 };
const growingOpenSegmentSx = { flex: '1 1 auto', width: 'auto', minWidth: 0 };
const cappedDropdownSegmentSx = { ...dropdownSegmentSx, flex: '0 0 auto', width: 'auto' };

export const FolderBar = ({
  recentFolders,
  isCheckingFolder,
  onOpenFolder,
  onSelectRecentFolder,
  onClearRecentFolders,
  secondaryAction,
  fullWidth = false,
}: FolderBarProps) => {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const dictionary = useDictionary();
  const uniqueRecentFolders = dedupeFolders(recentFolders);

  const select = (folderPath: string) => {
    setOpen(false);
    onSelectRecentFolder(folderPath);
  };

  const clearRecent = () => {
    setOpen(false);
    onClearRecentFolders?.();
  };

  const selectSecondary = () => {
    setOpen(false);
    secondaryAction?.onSelect();
  };

  return (
    <Box sx={fullWidth ? { width: '100%' } : undefined}>
      <ButtonGroup ref={anchorRef} variant="contained" size="small" disableElevation fullWidth={fullWidth}>
        <Button onClick={onOpenFolder} disabled={isCheckingFolder} sx={fullWidth ? growingOpenSegmentSx : undefined}>
          {isCheckingFolder ? dictionary.folderBar.checking : dictionary.folderBar.openFolder}
        </Button>
        <Button
          size="small"
          aria-label={secondaryAction === undefined ? dictionary.folderBar.recentFolders : dictionary.folderBar.folderActions}
          aria-haspopup="menu"
          disabled={uniqueRecentFolders.length === 0 && secondaryAction === undefined}
          onClick={() => setOpen(true)}
          sx={fullWidth ? cappedDropdownSegmentSx : dropdownSegmentSx}
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
        {uniqueRecentFolders.map((folderPath) => (
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
        {secondaryAction === undefined ? null : [
          uniqueRecentFolders.length === 0 ? null : <Divider key="secondary-action-divider" />,
          <MenuItem key="secondary-action" onClick={selectSecondary} disabled={secondaryAction.disabled === true}>
            {secondaryAction.label}
          </MenuItem>,
        ]}
        {onClearRecentFolders === undefined || uniqueRecentFolders.length === 0 ? null : [
          <Divider key="clear-recent-divider" />,
          <MenuItem key="clear-recent" onClick={clearRecent}>
            {dictionary.folderBar.clearRecent}
          </MenuItem>,
        ]}
      </Menu>
    </Box>
  );
};
