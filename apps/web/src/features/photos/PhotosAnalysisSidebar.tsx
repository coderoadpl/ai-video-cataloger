import type { ComponentProps, ReactNode } from 'react';
import { Box } from '@mui/material';

import { PhotosSidebar } from './PhotosSidebar.js';
import { PhotosScopeToggle } from './PhotosScopeToggle.js';
import { PhotosScopeToolbar } from './PhotosScopeToolbar.js';

type Props = Omit<ComponentProps<typeof PhotosSidebar>, 'scopeToggle' | 'toolbar'> & {
  facesAction: ReactNode;
};

export const PhotosAnalysisSidebar = ({ state, facesAction, ...props }: Props) => {
  return (
    <PhotosSidebar
      {...props}
      state={state}
      scopeToggle={(
        <PhotosScopeToggle
          scope={state.scope}
          onScopeChange={state.setScope}
          disabled={!state.treeScopeAvailable || state.isBusy}
          disabledReason={state.isBusy ? 'busy' : 'no-photo-subfolders'}
        />
      )}
      toolbar={(
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <PhotosScopeToolbar state={state} />
          {facesAction}
        </Box>
      )}
    />
  );
};
