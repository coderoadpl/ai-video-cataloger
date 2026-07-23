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

import type { TranscriptionMode } from './wizard-model.js';
import type { WizardController } from './use-wizard.js';

const OPTIONS: { value: TranscriptionMode; label: string; description: string }[] = [
  { value: 'managed', label: 'Managed whisper.cpp', description: 'The app downloads and builds a local whisper runtime.' },
  { value: 'own', label: 'My own whisper binary', description: 'Point at an existing or GPU-optimized install.' },
  { value: 'api', label: 'OpenAI Whisper API', description: 'Transcribe through the OpenAI API (usage is charged).' },
  { value: 'skip', label: 'Skip transcription', description: 'Analyze frames only, no audio transcript.' },
];

const asTranscriptionMode = (value: string): TranscriptionMode | null =>
  OPTIONS.find((option) => option.value === value)?.value ?? null;

export const TranscriptionStep = ({ controller }: { controller: WizardController }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-transcription">
    <Typography variant="h2">Choose transcription</Typography>
    <RadioGroup
      value={controller.transcriptionMode}
      onChange={(event) => {
        const mode = asTranscriptionMode(event.target.value);
        if (mode !== null) controller.setTranscriptionMode(mode);
      }}
    >
      {OPTIONS.map((option) => (
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
        <InputLabel id="wizard-whisper-model">Whisper model</InputLabel>
        <Select
          labelId="wizard-whisper-model"
          label="Whisper model"
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
              {model.downloaded ? ' (installed)' : ''}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    ) : null}

    {controller.transcriptionMode === 'managed' && controller.whisperBuildToolsMissing.length > 0 ? (
      <Alert severity="warning" data-testid="whisper-build-tools-warning">
        Building whisper needs: {controller.whisperBuildToolsMissing.join(', ')}.
      </Alert>
    ) : null}

    {controller.transcriptionMode === 'own' ? (
      <TextField
        size="small"
        label="Whisper binary path"
        value={controller.whisperBinaryPath}
        data-testid="whisper-binary-path"
        onChange={(event) => controller.setWhisperBinaryPath(event.target.value)}
      />
    ) : null}

    {controller.transcriptionMode === 'api' ? (
      <TextField
        size="small"
        label="OpenAI API key"
        type="password"
        value={controller.whisperApiCredential}
        autoComplete="new-password"
        helperText="Leave blank to keep an existing OpenAI credential."
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
