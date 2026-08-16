import { Box, Paper, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { FilmIcon, ImageIcon } from './icons.js';

interface AnalysisEmptyStateProps {
  media: 'video' | 'photo';
  empty: boolean;
}

export const AnalysisEmptyState = ({ media, empty }: AnalysisEmptyStateProps) => {
  const dictionary = useDictionary();
  const message = media === 'video'
    ? empty ? dictionary.analysisEmptyState.noVideos : dictionary.analysisEmptyState.selectVideo
    : empty ? dictionary.analysisEmptyState.noPhotos : dictionary.analysisEmptyState.selectPhoto;
  const icon = media === 'video'
    ? <FilmIcon sx={{ color: 'status.notTracked.main' }} />
    : <ImageIcon sx={{ color: 'status.notTracked.main' }} />;

  return (
    <Box sx={{ minHeight: '100%', p: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Paper
        variant="outlined"
        data-testid="analysis-empty-state"
        sx={{ width: '100%', maxWidth: 480, p: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}
      >
        <Box sx={{ display: 'flex' }}>{icon}</Box>
        <Typography variant="body2" color="text.secondary">{message}</Typography>
      </Paper>
    </Box>
  );
};
