import { type ReactNode } from 'react';
import { Box, Paper, Typography } from '@mui/material';

import { InfoIcon } from './icons.js';

interface NoticePanelProps {
  message: string;
  testId: string;
  action?: ReactNode;
}

export const NoticePanel = ({ message, testId, action }: NoticePanelProps) => (
  <Paper
    variant="outlined"
    data-testid={testId}
    role="status"
    sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}
  >
    <InfoIcon fontSize="small" sx={{ color: 'status.notTracked.main' }} />
    <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>{message}</Typography>
    {action === undefined ? null : <Box sx={{ display: 'flex' }}>{action}</Box>}
  </Paper>
);
