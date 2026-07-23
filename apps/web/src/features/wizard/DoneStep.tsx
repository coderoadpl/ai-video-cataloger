import { Box, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import type { WizardController } from './use-wizard.js';

export const DoneStep = ({ controller }: { controller: WizardController }) => {
  const dictionary = useDictionary();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-done">
      <Typography variant="h1">{dictionary.wizard.done.title}</Typography>
      <Typography variant="body2">
        {controller.readiness?.ready !== true
          ? dictionary.wizard.done.incomplete
          : controller.transcriptionMode === 'skip'
            ? dictionary.wizard.done.skip
            : dictionary.wizard.done.ready}
      </Typography>
    </Box>
  );
};
