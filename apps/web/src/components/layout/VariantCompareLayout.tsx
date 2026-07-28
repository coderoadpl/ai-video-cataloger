import { type ReactNode } from 'react';
import { Box } from '@mui/material';

interface VariantCompareLayoutProps {
  heading: ReactNode;
  actions: ReactNode;
  notice?: ReactNode;
  columns: ReactNode;
}

export const VariantCompareLayout = ({
  heading,
  actions,
  notice,
  columns,
}: VariantCompareLayoutProps) => (
  <Box
    data-testid="variant-compare-layout"
    sx={{ p: 3, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
  >
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>{heading}</Box>
      <Box sx={{ flexShrink: 0 }}>{actions}</Box>
    </Box>
    {notice}
    <Box
      data-testid="variant-compare-columns"
      sx={{
        display: 'grid',
        gridAutoFlow: 'column',
        gridAutoColumns: { xs: 'minmax(280px, 1fr)', md: 'minmax(360px, 1fr)' },
        gap: 2,
        alignItems: 'start',
        minWidth: 0,
        overflowX: 'auto',
        pb: 1,
      }}
    >
      {columns}
    </Box>
  </Box>
);
