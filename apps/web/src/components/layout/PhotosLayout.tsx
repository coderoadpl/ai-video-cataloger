import { type ReactNode } from 'react';
import { Box } from '@mui/material';

interface PhotosLayoutProps {
  heading: ReactNode;
  toolbar: ReactNode;
  notice?: ReactNode;
  grid: ReactNode;
  detail: ReactNode;
}

export const PhotosLayout = ({ heading, toolbar, notice, grid, detail }: PhotosLayoutProps) => (
  <Box
    data-testid="photos-layout"
    sx={{ p: 3, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}
  >
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
      <Box sx={{ minWidth: 0 }}>{heading}</Box>
      <Box sx={{ flexShrink: 0 }}>{toolbar}</Box>
    </Box>
    {notice}
    <Box
      data-testid="photos-layout-split"
      sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 320px', gap: 2 }}
    >
      <Box sx={{ minWidth: 0, overflow: 'auto' }}>{grid}</Box>
      <Box sx={{ minWidth: 0, overflow: 'auto' }}>{detail}</Box>
    </Box>
  </Box>
);
