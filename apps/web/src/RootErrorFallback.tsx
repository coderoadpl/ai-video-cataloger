import { Box, Button, Paper, Typography } from '@mui/material';

import { ApiError } from '@core/client/index.js';

import { getDict } from './i18n/dictionary.js';
import { formatAnalyzerError } from './lib/analyzer-error-message.js';
import { activeTraceId } from './observability.js';

const FALLBACK_DICTIONARY = getDict('en');

const detailFor = (error: unknown): string =>
  error instanceof ApiError
    ? formatAnalyzerError(error.appError.message, FALLBACK_DICTIONARY.errors)
    : 'An unexpected error interrupted the app.';

interface RootErrorFallbackProps {
  error: unknown;
  traceId: string | undefined;
}

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

export const renderRootErrorFallback = (error: unknown) => (
  <RootErrorFallback error={error} traceId={activeTraceId()} />
);
