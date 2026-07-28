import { useState } from 'react';
import { Box, ButtonBase } from '@mui/material';

import { mediaUrl } from '../../lib/media-url.js';

export const FrameGallery = ({
  framePaths,
  frameLabel,
  frameUrl = mediaUrl,
}: {
  framePaths: readonly string[];
  frameLabel: (index: number) => string;
  frameUrl?: (path: string) => string;
}) => {
  const [selected, setSelected] = useState(0);
  const active = Math.min(selected, framePaths.length - 1);
  const activeFrame = framePaths[active];
  if (activeFrame === undefined) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box
        sx={{
          position: 'relative',
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: 'common.black',
          aspectRatio: '16 / 9',
        }}
      >
        <Box
          component="img"
          data-testid="active-frame"
          src={frameUrl(activeFrame)}
          alt={frameLabel(active + 1)}
          sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </Box>
      {framePaths.length > 1 ? (
        <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1 }}>
          {framePaths.map((framePath, index) => (
            <ButtonBase
              key={framePath}
              onClick={() => setSelected(index)}
              aria-label={frameLabel(index + 1)}
              sx={(theme) => ({
                flexShrink: 0,
                width: 80,
                height: 48,
                borderRadius: 1,
                overflow: 'hidden',
                border: 2,
                borderStyle: 'solid',
                borderColor: index === active ? theme.palette.primary.main : 'transparent',
              })}
            >
              <Box
                component="img"
                src={frameUrl(framePath)}
                alt={frameLabel(index + 1)}
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </ButtonBase>
          ))}
        </Box>
      ) : null}
    </Box>
  );
};
