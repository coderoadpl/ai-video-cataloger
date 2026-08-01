import { Alert, Box, Button, LinearProgress, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import type { PhotosAnalysisScope, PhotosAnalysisState } from './use-photos-analysis.js';

interface PhotosScopeToolbarProps {
  state: PhotosAnalysisState;
}

export const PhotosScopeToolbar = ({ state }: PhotosScopeToolbarProps) => {
  const dictionary = useDictionary();
  const counts = state.counts;
  const proxiesPending = state.selectedRoot !== null && counts !== null && counts.proxied === 0 && counts.photos > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={state.scope}
        onChange={(_event, next: PhotosAnalysisScope | null) => {
          if (next !== null) state.setScope(next);
        }}
      >
        <ToggleButton value="folder" data-testid="photos-scope-folder">
          {dictionary.photosSidebar.scopeThisFolder}
        </ToggleButton>
        <ToggleButton value="all" data-testid="photos-scope-all">
          {dictionary.photosSidebar.scopeAllFolders}
        </ToggleButton>
      </ToggleButtonGroup>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          size="small"
          fullWidth
          onClick={state.scanFolder}
          disabled={state.isBusy}
          data-testid="photos-scan-action"
        >
          {dictionary.photos.scanFolderAction}
        </Button>
        <Button
          variant="contained"
          size="small"
          fullWidth
          onClick={state.analyzePhotos}
          disabled={state.isBusy || !state.canAnalyze}
          data-testid="photos-analyze-action"
        >
          {dictionary.photosSidebar.analyzeFolderAction}
        </Button>
      </Box>
      {state.activeJobLabel !== null ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="caption" noWrap>{state.activeJobLabel}</Typography>
          <LinearProgress
            variant={state.analyzeProgress === null ? 'indeterminate' : 'determinate'}
            value={state.analyzeProgress === null || state.analyzeProgress.total === 0
              ? 0
              : (state.analyzeProgress.current / state.analyzeProgress.total) * 100}
          />
        </Box>
      ) : null}
      {proxiesPending ? (
        <Alert
          severity="info"
          data-testid="photos-proxies-pending"
          action={
            <Button color="inherit" size="small" onClick={state.generateProxies} disabled={state.isBusy}>
              {dictionary.photos.generateProxiesAction}
            </Button>
          }
        >
          {dictionary.photos.proxiesPendingStrip}
        </Alert>
      ) : null}
    </Box>
  );
};
