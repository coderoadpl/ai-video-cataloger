import { Box, Button, Paper, Typography } from '@mui/material';

import { ApiError } from '@core/client/index.js';

import { activeTraceId } from './observability.js';

/**
 * The renderer surfaces an `AppError` message verbatim — it never re-maps the
 * taxonomy (that mapping is the contract's job). A non-`ApiError` throw (a bug
 * in a component) gets a generic message instead of leaking a stack.
 */
const detailFor = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : 'An unexpected error interrupted the app.';

interface RootErrorFallbackProps {
  error: unknown;
  traceId: string | undefined;
}

/**
 * Presentational fallback for the root error boundary. Shows the taxonomy
 * message and, whenever tracing is active, the trace id so a user can paste it
 * into a support request; it is simply absent when tracing is not configured.
 */
export const RootErrorFallback = ({ error, traceId }: RootErrorFallbackProps) => (
  <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
    <Paper
      variant="outlined"
      role="alert"
      sx={{ width: '100%', maxWidth: '23rem', px: '1.8rem', pt: '2rem', pb: '1.6rem' }}
    >
      <Typography variant="h1" sx={{ mb: '0.4rem' }}>
        Something went wrong
      </Typography>
      <Typography variant="body2" sx={{ mb: '1.4rem' }}>
        {detailFor(error)}
      </Typography>
      {traceId === undefined ? null : (
        <Typography variant="caption" component="p" sx={{ mb: '1.4rem' }}>
          Trace ID: <code>{traceId}</code>
        </Typography>
      )}
      <Button variant="contained" fullWidth onClick={() => window.location.reload()}>
        Reload
      </Button>
    </Paper>
  </Box>
);

/** Render-prop entry for the boundary: binds the live trace id. */
export const renderRootErrorFallback = (error: unknown) => (
  <RootErrorFallback error={error} traceId={activeTraceId()} />
);
