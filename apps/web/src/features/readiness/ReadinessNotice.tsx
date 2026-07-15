import { Alert, Box, Button, Typography } from '@mui/material';
import type { z } from 'zod';

import type { readinessOutputSchema } from '@core/contract/index.js';

type Readiness = z.output<typeof readinessOutputSchema>;

export const ReadinessNotice = ({
  readiness,
  onOpenSettings,
  onOpenSetup,
}: {
  readiness: Readiness;
  onOpenSettings: () => void;
  onOpenSetup: () => void;
}) => {
  if (readiness.ready) return null;
  return (
    <Alert severity="warning" data-testid="readiness-notice" sx={{ m: 2 }}>
      <Typography variant="h2">Processing setup is incomplete</Typography>
      <Typography variant="body2">
        {readiness.missingPieces.map((piece) => piece.name).join(', ')} must be configured before analysis can run.
      </Typography>
      {readiness.suggestedAction === null ? null : (
        <Typography variant="caption">{readiness.suggestedAction}</Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        <Button size="small" variant="outlined" color="inherit" onClick={onOpenSettings}>
          Open Settings
        </Button>
        <Button size="small" variant="contained" onClick={onOpenSetup}>
          Open Setup Wizard
        </Button>
      </Box>
    </Alert>
  );
};
