import { type ReactNode } from 'react';
import { Box, Paper, Typography } from '@mui/material';

export type EmptyStateVariant = 'page' | 'pane';

interface EmptyStateProps {
  title: string;
  body: string;
  testId: string;
  action?: ReactNode;
  icon?: ReactNode;
  bodyTestId?: string;
  variant?: EmptyStateVariant;
}

export const EmptyState = ({
  title,
  body,
  testId,
  action = null,
  icon = null,
  bodyTestId,
  variant = 'page',
}: EmptyStateProps) => {
  const content = (
    <>
      {icon === null ? null : <Box sx={{ display: 'flex' }}>{icon}</Box>}
      <Typography variant="h2" color="text.primary">{title}</Typography>
      <Typography variant="body2" sx={{ maxWidth: 420 }} data-testid={bodyTestId}>{body}</Typography>
      {action === null ? null : <Box sx={{ mt: 1 }}>{action}</Box>}
    </>
  );

  if (variant === 'pane') {
    return (
      <Box sx={{ minHeight: '100%', p: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Paper
          variant="outlined"
          data-testid={testId}
          data-empty-state-variant="pane"
          sx={{
            width: '100%',
            maxWidth: 480,
            p: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 1,
            color: 'text.secondary',
          }}
        >
          {content}
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      data-testid={testId}
      data-empty-state-variant="page"
      sx={{
        flex: 1,
        minHeight: 260,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 1,
        color: 'text.secondary',
      }}
    >
      {content}
    </Box>
  );
};
