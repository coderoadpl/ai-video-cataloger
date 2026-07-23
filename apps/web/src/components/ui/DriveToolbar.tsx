import { Box, Button, Typography } from '@mui/material';

import { AccountTreeIcon } from './icons.js';

export interface DriveProgressView {
  currentFolder: number;
  totalFolders: number;
  filesDone: number;
  filesSkipped: number;
}

interface DriveToolbarProps {
  onAnalyzeTree: () => void;
  isBusy: boolean;
  progress: DriveProgressView | null;
  disabledReason?: string | undefined;
}

export const DriveToolbar = ({ onAnalyzeTree, isBusy, progress, disabledReason }: DriveToolbarProps) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
    <Button
      data-testid="analyze-tree-button"
      variant="outlined"
      fullWidth
      size="small"
      disabled={isBusy || disabledReason !== undefined}
      startIcon={<AccountTreeIcon fontSize="small" />}
      onClick={onAnalyzeTree}
    >
      Analyze all including subfolders
    </Button>
    {progress === null ? null : (
      <Typography data-testid="drive-progress" variant="caption" color="text.secondary">
        Folder {progress.currentFolder}/{progress.totalFolders} - {progress.filesDone} files done,{' '}
        {progress.filesSkipped} skipped
      </Typography>
    )}
  </Box>
);
