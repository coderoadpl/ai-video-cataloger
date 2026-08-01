import type { ReactNode } from 'react';
import { alpha, Box, Typography, useTheme } from '@mui/material';

import { gradientIndexFor, middleEllipsis } from '../../lib/placeholder-gradient.js';
import { placeholderGradients } from '../../theme.js';
import { StorageIcon } from './icons.js';

interface PlaceholderTileProps {
  name: string;
  testId: string;
  caption?: ReactNode;
  captionTestId?: string;
}

export const PlaceholderTile = ({ name, testId, caption, captionTestId }: PlaceholderTileProps) => {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const gradients = dark ? placeholderGradients.dark : placeholderGradients.light;
  const foreground = dark ? theme.palette.common.white : theme.palette.text.primary;

  return (
    <Box
      data-testid={testId}
      style={{ background: gradients[gradientIndexFor(name)] }}
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 0.5,
        p: 1.5,
        border: `1px solid ${alpha(foreground, 0.14)}`,
      }}
    >
      <StorageIcon fontSize="small" sx={{ color: alpha(foreground, 0.72) }} />
      <Typography
        variant="caption"
        sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', color: foreground, fontWeight: 600 }}
      >
        {middleEllipsis(name, 40)}
      </Typography>
      {caption === undefined ? null : (
        <Typography variant="caption" data-testid={captionTestId} sx={{ color: alpha(foreground, 0.7) }}>
          {caption}
        </Typography>
      )}
    </Box>
  );
};
