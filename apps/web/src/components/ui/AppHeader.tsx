import { Box, Button, Typography } from '@mui/material';

import { versionLabel } from '../../lib/format.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { FolderBar } from './FolderBar.js';
import { ModeSwitcher, type AppMode } from './ModeSwitcher.js';
import { AnalysisMediaToggle, type AnalysisMedia } from './AnalysisMediaToggle.js';

interface AppHeaderProps {
  appVersion: string;
  recentFolders: string[];
  isCheckingFolder: boolean;
  onOpenFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
  onShowSettings: () => void;
  onShowModelManager: () => void;
  onShowPrerequisites: () => void;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  analysisMedia: AnalysisMedia;
  onAnalysisMediaChange: (media: AnalysisMedia) => void;
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
  mode,
  onModeChange,
  analysisMedia,
  onAnalysisMediaChange,
}: AppHeaderProps) => {
  const dictionary = useDictionary();

  return (
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
      <ModeSwitcher mode={mode} onModeChange={onModeChange} />
      {mode === 'analysis' ? (
        <AnalysisMediaToggle media={analysisMedia} onSelect={onAnalysisMediaChange} />
      ) : null}
      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        {mode === 'analysis' ? (
          <FolderBar
            recentFolders={recentFolders}
            isCheckingFolder={isCheckingFolder}
            onOpenFolder={onOpenFolder}
            onSelectRecentFolder={onSelectRecentFolder}
          />
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          variant="outlined"
          size="small"
          color="inherit"
          onClick={onShowSettings}
          data-testid="open-settings-button"
        >
          {dictionary.appHeader.settings}
        </Button>
        <Button variant="outlined" size="small" color="inherit" onClick={onShowModelManager}>
          {dictionary.appHeader.models}
        </Button>
        <Button variant="text" size="small" color="inherit" onClick={onShowPrerequisites}>
          {dictionary.appHeader.prerequisites}
        </Button>
      </Box>
    </Box>
  );
};
