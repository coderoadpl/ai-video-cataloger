import { type ReactElement, type ReactNode } from 'react';
import { Box, Paper, type SvgIconProps } from '@mui/material';

import { type StatusToken } from '../../theme.js';
import { CardHeader } from './CardHeader.js';

interface DetailStatusCardProps {
  icon: ReactElement<SvgIconProps>;
  title: string;
  token: StatusToken;
  action: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
  testId?: string;
}

export const DetailStatusCard = ({
  icon,
  title,
  token,
  action,
  body,
  footer,
  testId,
}: DetailStatusCardProps) => (
  <Paper
    variant="outlined"
    data-testid={testId}
    data-detail-status-card="true"
    sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}
  >
    <Box sx={(theme) => ({ '& .MuiSvgIcon-root': { color: theme.palette.status[token].main } })}>
      <CardHeader icon={icon} title={title} />
    </Box>
    {body}
    <Box>{action}</Box>
    {footer}
  </Paper>
);
