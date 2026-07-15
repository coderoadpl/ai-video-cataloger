import { Box, Typography } from '@mui/material';

export const WelcomeStep = () => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-welcome">
    <Typography variant="h1">Welcome to AI Video Cataloger</Typography>
    <Typography variant="body2">
      This guided setup configures an analyzer and transcription so your first analysis works end to end. You can
      change everything later in Settings.
    </Typography>
    <Typography variant="body2">
      Choose a fully local model (no account needed), an API provider, or one of your installed agent CLIs. Nothing
      leaves your machine unless you pick an API provider.
    </Typography>
  </Box>
);
