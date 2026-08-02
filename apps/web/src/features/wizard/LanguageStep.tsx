import { Alert, Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import type { WizardController } from './use-wizard.js';
import { WIZARD_OUTPUT_LANGUAGE_OPTIONS, WIZARD_UI_LANGUAGE_OPTIONS } from './wizard-model.js';

export const LanguageStep = ({ controller }: { controller: WizardController }) => {
  const dictionary = useDictionary();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="wizard-step-language">
      <Typography variant="h1">{dictionary.language.stepTitle}</Typography>
      <Typography variant="body2">{dictionary.language.stepDescription}</Typography>

      <FormControl fullWidth size="small">
        <InputLabel id="wizard-ui-language-label">{dictionary.language.uiLabel}</InputLabel>
        <Select
          labelId="wizard-ui-language-label"
          label={dictionary.language.uiLabel}
          value={controller.uiLanguage}
          data-testid="wizard-ui-language-select"
          onChange={(event) => controller.setUiLanguage(event.target.value === 'pl' ? 'pl' : 'en')}
        >
          {WIZARD_UI_LANGUAGE_OPTIONS.map((value) => (
            <MenuItem key={value} value={value}>
              {value === 'pl' ? dictionary.language.optionPolish : dictionary.language.optionEnglish}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="caption" color="text.secondary">
        {dictionary.language.uiHelper}
      </Typography>

      <FormControl fullWidth size="small">
        <InputLabel id="wizard-output-language-label">{dictionary.language.outputLabel}</InputLabel>
        <Select
          labelId="wizard-output-language-label"
          label={dictionary.language.outputLabel}
          value={controller.outputLanguage}
          data-testid="wizard-output-language-select"
          onChange={(event) => controller.setOutputLanguage(event.target.value)}
        >
          {WIZARD_OUTPUT_LANGUAGE_OPTIONS.map((value) => (
            <MenuItem key={value} value={value}>
              {value === 'auto'
                ? dictionary.language.optionAuto
                : value === 'pl'
                  ? dictionary.language.optionPolish
                  : dictionary.language.optionEnglish}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="caption" color="text.secondary">
        {dictionary.language.outputHelper}
      </Typography>
      {controller.validation === 'error' && controller.validationMessage !== null ? (
        <Alert severity="error" data-testid="language-validation-error">
          {controller.validationMessage}
        </Alert>
      ) : null}
    </Box>
  );
};
