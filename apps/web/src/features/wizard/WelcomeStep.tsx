import { Box, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

export const WelcomeStep = () => {
  const dictionary = useDictionary();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-welcome">
      <Typography variant="h1">{dictionary.wizard.welcome.title}</Typography>
      <Typography variant="body2">{dictionary.wizard.welcome.body}</Typography>
      <Typography variant="body2" data-testid="welcome-privacy-copy">
        {dictionary.wizard.welcome.privacy}
      </Typography>
    </Box>
  );
};
