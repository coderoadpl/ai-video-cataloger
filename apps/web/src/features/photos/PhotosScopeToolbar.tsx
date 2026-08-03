import { Box, Button, LinearProgress, Paper, Typography } from '@mui/material';

import { CardHeader } from '../../components/ui/CardHeader.js';
import { ImageIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import type { PhotosAnalysisState } from './use-photos-analysis.js';

interface PhotosScopeToolbarProps {
  state: PhotosAnalysisState;
}

export const PhotosScopeToolbar = ({ state }: PhotosScopeToolbarProps) => {
  const dictionary = useDictionary();
  const counts = state.counts;
  const proxiesPending = state.selectedRoot !== null && counts !== null && counts.proxied === 0 && counts.photos > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          size="small"
          fullWidth
          onClick={state.scanFolder}
          disabled={state.isBusy || state.folder === null}
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
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography variant="caption" noWrap data-testid="photos-analyze-status-label">
              {state.analyzeStatusLabel}
            </Typography>
            {state.isCancellable ? (
              <Button
                color="error"
                size="small"
                onClick={state.requestCancelAnalysis}
                data-testid="photos-cancel-analysis-action"
              >
                {dictionary.photos.cancelAnalysisAction}
              </Button>
            ) : null}
          </Box>
          <LinearProgress
            variant={state.analyzeProgress === null ? 'indeterminate' : 'determinate'}
            value={state.analyzeProgress === null || state.analyzeProgress.total === 0
              ? 0
              : (state.analyzeProgress.current / state.analyzeProgress.total) * 100}
          />
        </Box>
      ) : null}
      {proxiesPending ? (
        <Paper
          variant="outlined"
          data-testid="photos-proxies-pending"
          sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          <CardHeader
            icon={<ImageIcon fontSize="small" sx={{ color: 'status.notTracked.main' }} />}
            title={dictionary.photos.proxiesPendingStrip}
          />
          <Box>
            <Button variant="outlined" size="small" onClick={state.generateProxies} disabled={state.isBusy}>
              {dictionary.photos.generateProxiesAction}
            </Button>
          </Box>
        </Paper>
      ) : null}
    </Box>
  );
};
