import { Alert, Box, Button, Typography } from '@mui/material';
import type { z } from 'zod';

import type { readinessOutputSchema } from '@core/contract/index.js';

import { useDictionary } from '../../i18n/use-dictionary.js';

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
  const dictionary = useDictionary();
  if (readiness.ready) return null;
  return (
    <Alert severity="warning" data-testid="readiness-notice" sx={{ m: 2 }}>
      <Typography variant="h2">{dictionary.readinessNotice.title}</Typography>
      <Typography variant="body2">
        {dictionary.readinessNotice.missing(readiness.missingPieces.map((piece) => piece.name).join(', '))}
      </Typography>
      {readiness.suggestedAction === null ? null : (
        <Typography variant="caption">{readiness.suggestedAction}</Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        <Button size="small" variant="outlined" color="inherit" onClick={onOpenSettings}>
          {dictionary.readinessNotice.openSettings}
        </Button>
        <Button size="small" variant="contained" onClick={onOpenSetup}>
          {dictionary.readinessNotice.openSetupWizard}
        </Button>
      </Box>
    </Alert>
  );
};
