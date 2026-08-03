import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

export const CardHeader = ({ icon, title }: { icon: ReactNode; title: string }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
    <Typography variant="h2">{title}</Typography>
  </Box>
);
