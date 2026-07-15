import { Box, Typography } from '@mui/material';

import type { WizardController } from './use-wizard.js';

export const DoneStep = ({ controller }: { controller: WizardController }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-done">
    <Typography variant="h1">Setup complete</Typography>
    <Typography variant="body2">
      {controller.readiness?.ready !== true
        ? 'You can finish now and complete the remaining pieces from Settings or the Model Manager whenever you like.'
        : controller.transcriptionMode === 'skip'
          ? 'Your analyzer is ready in frames-only mode. Audio transcription will be skipped.'
          : 'Your analyzer and transcription are ready. Open a folder and start analyzing.'}
    </Typography>
  </Box>
);
