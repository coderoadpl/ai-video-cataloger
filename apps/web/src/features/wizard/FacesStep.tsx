import { Alert, Box, FormControlLabel, Switch, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import type { WizardController } from './use-wizard.js';

export const FacesStep = ({ controller }: { controller: WizardController }) => {
  const dictionary = useDictionary();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-faces">
      <Typography variant="h2">{dictionary.wizard.faces.title}</Typography>
      <Typography variant="body2">{dictionary.wizard.faces.localModels}</Typography>
      <Typography variant="body2">{dictionary.wizard.faces.peopleIndex}</Typography>
      <FormControlLabel
        control={(
          <Switch
            checked={controller.facesEnabled}
            data-testid="wizard-faces-enabled-switch"
            onChange={(event) => controller.setFacesEnabled(event.target.checked)}
          />
        )}
        label={dictionary.wizard.faces.enableLabel}
      />
      {controller.validation === 'error' && controller.validationMessage !== null ? (
        <Alert severity="error" data-testid="faces-validation-error">
          {controller.validationMessage}
        </Alert>
      ) : null}
    </Box>
  );
};
