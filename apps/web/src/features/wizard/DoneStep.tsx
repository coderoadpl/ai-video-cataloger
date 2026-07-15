import { Box, Typography } from '@mui/material';

import type { WizardController } from './use-wizard.js';

export const DoneStep = ({ controller }: { controller: WizardController }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-done">
    <Typography variant="h1">Setup complete</Typography>
    <Typography variant="body2">
      {controller.readiness?.ready === true
        ? 'Your analyzer and transcription are ready. Open a folder and start analyzing.'
        : 'You can finish now and complete the remaining pieces from Settings or the Model Manager whenever you like.'}
    </Typography>
  </Box>
);
