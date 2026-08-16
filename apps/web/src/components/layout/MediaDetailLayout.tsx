import { type ReactNode } from 'react';
import { Box } from '@mui/material';

interface MediaDetailLayoutProps {
  main: ReactNode;
  media: ReactNode;
  below: ReactNode;
  layoutTestId: string;
  mainTestId: string;
  mediaTestId: string;
  belowTestId: string;
  detailTestAttributes?: Readonly<Record<`data-${string}`, string | undefined>>;
}

export const MediaDetailLayout = ({
  main,
  media,
  below,
  layoutTestId,
  mainTestId,
  mediaTestId,
  belowTestId,
  detailTestAttributes,
}: MediaDetailLayoutProps) => (
  <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: { xs: 780, lg: 1180 } }}>
    <Box
      {...detailTestAttributes}
      data-testid={layoutTestId}
      sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 3, alignItems: 'flex-start' }}
    >
      <Box
        data-testid={mainTestId}
        sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        {main}
      </Box>
      <Box
        data-testid={mediaTestId}
        sx={{ width: { xs: '100%', lg: 440 }, flexShrink: 0, order: { xs: -1, lg: 0 } }}
      >
        {media}
      </Box>
    </Box>
    {below === null ? null : <Box data-testid={belowTestId}>{below}</Box>}
  </Box>
);
