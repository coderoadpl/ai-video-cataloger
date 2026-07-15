import { useEffect } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';

import type { WizardController } from './use-wizard.js';

export const ReadinessStep = ({ controller }: { controller: WizardController }) => {
  const { readiness, isCheckingReadiness, checkReadiness } = controller;
  useEffect(() => {
    if (readiness === null && !isCheckingReadiness) checkReadiness();
  }, [readiness, isCheckingReadiness, checkReadiness]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-readiness">
      <Typography variant="h2">Final check</Typography>
      {isCheckingReadiness || readiness === null ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} data-testid="readiness-checking">
          <CircularProgress size={18} />
          <Typography variant="body2">Checking your configuration…</Typography>
        </Box>
      ) : readiness.ready ? (
        <Alert severity="success" data-testid="readiness-ready">
          Everything is configured. You are ready to analyze videos.
        </Alert>
      ) : (
        <Alert severity="warning" data-testid="readiness-not-ready">
          <Typography variant="body2">
            {readiness.missingPieces.map((piece) => piece.name).join(', ')} still needs attention.
          </Typography>
          {readiness.suggestedAction === null ? null : (
            <Typography variant="caption">{readiness.suggestedAction}</Typography>
          )}
        </Alert>
      )}
    </Box>
  );
};
