import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

interface PageHeaderProps {
  title: string;
  testId: string;
  subtitle?: ReactNode;
  metrics?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export const PageHeader = ({ title, testId, subtitle, metrics, actions, children }: PageHeaderProps) => (
  <Box
    data-testid={testId}
    sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
  >
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h1">{title}</Typography>
        {subtitle === undefined ? null : (
          <Typography variant="caption" component="div">{subtitle}</Typography>
        )}
        {metrics === undefined ? null : <Box sx={{ mt: 0.25 }}>{metrics}</Box>}
      </Box>
      {actions === undefined ? null : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>
      )}
    </Box>
    {children === undefined ? null : <Box sx={{ mt: 1 }}>{children}</Box>}
  </Box>
);
