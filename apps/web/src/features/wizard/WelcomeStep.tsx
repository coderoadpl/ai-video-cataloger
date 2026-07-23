import { Box, Typography } from '@mui/material';

export const WelcomeStep = () => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-welcome">
    <Typography variant="h1">Welcome to AI Video Cataloger</Typography>
    <Typography variant="body2">
      This guided setup configures an analyzer and transcription so your first analysis works end to end. You can
      change everything later in Settings.
    </Typography>
    <Typography variant="body2" data-testid="welcome-privacy-copy">
      Choose a fully local model (no account needed), an API provider, or one of your installed agent CLIs. The app
      itself sends nothing to the cloud. Your data — frames and transcripts — leaves this machine only if you choose
      to send it to your own providers: an API key you enter, or an agent CLI harness you already use (Claude Code,
      Codex, Cursor). A fully local model keeps everything on your Mac.
    </Typography>
  </Box>
);
