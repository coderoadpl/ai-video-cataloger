import {
  Alert,
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import type { TranscriptionMode } from './wizard-model.js';
import type { WizardController } from './use-wizard.js';

const TRANSCRIPTION_MODES: readonly TranscriptionMode[] = ['managed', 'own', 'api', 'skip'];

const asTranscriptionMode = (value: string): TranscriptionMode | null =>
  TRANSCRIPTION_MODES.find((option) => option === value) ?? null;

export const TranscriptionStep = ({ controller }: { controller: WizardController }) => {
  const dictionary = useDictionary();
  const options: { value: TranscriptionMode; label: string; description: string }[] = [
    {
      value: 'managed',
      label: dictionary.wizard.transcription.managedLabel,
      description: dictionary.wizard.transcription.managedDescription,
    },
    {
      value: 'own',
      label: dictionary.wizard.transcription.ownLabel,
      description: dictionary.wizard.transcription.ownDescription,
    },
    {
      value: 'api',
      label: dictionary.wizard.transcription.apiLabel,
      description: dictionary.wizard.transcription.apiDescription,
    },
    {
      value: 'skip',
      label: dictionary.wizard.transcription.skipLabel,
      description: dictionary.wizard.transcription.skipDescription,
    },
  ];

  return (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-transcription">
    <Typography variant="h2">{dictionary.wizard.transcription.title}</Typography>
    <RadioGroup
      value={controller.transcriptionMode}
      onChange={(event) => {
        const mode = asTranscriptionMode(event.target.value);
        if (mode !== null) controller.setTranscriptionMode(mode);
      }}
    >
      {options.map((option) => (
        <FormControlLabel
          key={option.value}
          value={option.value}
          control={<Radio size="small" />}
          data-testid={`transcription-${option.value}`}
          label={
            <Box>
              <Typography variant="body2">{option.label}</Typography>
              <Typography variant="caption">{option.description}</Typography>
            </Box>
          }
        />
      ))}
    </RadioGroup>

    {(controller.transcriptionMode === 'managed' || controller.transcriptionMode === 'own')
      && controller.whisperModelOptions.length > 0 ? (
      <FormControl fullWidth size="small" data-testid="transcription-model-control">
        <InputLabel id="wizard-whisper-model">{dictionary.wizard.transcription.whisperModel}</InputLabel>
        <Select
          labelId="wizard-whisper-model"
          label={dictionary.wizard.transcription.whisperModel}
          value={controller.whisperModel}
          data-testid="wizard-whisper-model-select"
          onChange={(event) => {
            const next = controller.whisperModelOptions.find((model) => model.name === event.target.value);
            if (next !== undefined) controller.setWhisperModel(next.name);
          }}
        >
          {controller.whisperModelOptions.map((model) => (
            <MenuItem key={model.name} value={model.name}>
              {model.name} · {model.size}
              {model.downloaded ? dictionary.wizard.transcription.installedSuffix : ''}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    ) : null}

    {controller.transcriptionMode === 'managed' && controller.whisperBuildToolsMissing.length > 0 ? (
      <Alert severity="warning" data-testid="whisper-build-tools-warning">
        {dictionary.wizard.transcription.buildToolsWarning(controller.whisperBuildToolsMissing.join(', '))}
      </Alert>
    ) : null}

    {controller.transcriptionMode === 'own' ? (
      <TextField
        size="small"
        label={dictionary.wizard.transcription.whisperBinaryPath}
        value={controller.whisperBinaryPath}
        data-testid="whisper-binary-path"
        onChange={(event) => controller.setWhisperBinaryPath(event.target.value)}
      />
    ) : null}

    {controller.transcriptionMode === 'api' ? (
      <TextField
        size="small"
        label={dictionary.wizard.transcription.openAiApiKey}
        type="password"
        value={controller.whisperApiCredential}
        autoComplete="new-password"
        helperText={dictionary.wizard.transcription.openAiApiKeyHelper}
        onChange={(event) => controller.setWhisperApiCredential(event.target.value)}
      />
    ) : null}

    {controller.validation === 'error' && controller.validationMessage !== null ? (
      <Alert severity="error" data-testid="transcription-validation-error">
        {controller.validationMessage}
      </Alert>
    ) : null}
  </Box>
  );
};
