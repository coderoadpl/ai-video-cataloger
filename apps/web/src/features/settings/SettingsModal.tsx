import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

import { SettingsAnalyzerSection } from './SettingsAnalyzerSection.js';
import {
  OUTPUT_LANGUAGE_OPTIONS,
  WHISPER_MODEL_OPTIONS,
  WHISPER_MODE_OPTIONS,
  type SettingsDraft,
} from './settings-model.js';
import { useSettings } from './use-settings.js';

interface SettingsModalProps {
  open: boolean;
  folder: string | null;
  onClose: () => void;
  onSaved?: (() => void) | undefined;
}

export const SettingsModal = ({ open, folder, onClose, onSaved }: SettingsModalProps) => {
  const settings = useSettings({
    open,
    folder,
    onSaved: () => {
      onSaved?.();
      onClose();
    },
  });
  const { draft } = settings;

  const patch = (value: Partial<SettingsDraft>) => settings.setDraft(value);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="settings-modal">
      <DialogTitle>Settings</DialogTitle>
      <DialogContent dividers>
        {folder === null ? (
          <DialogContentText data-testid="settings-no-folder">
            Please select a folder first to configure settings.
          </DialogContentText>
        ) : settings.isLoading || draft === null ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 4 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Loading settings…</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, py: 1 }}>
            {settings.error === null ? null : <Alert severity="error">{settings.error}</Alert>}
            {settings.inherited.length === 0 ? null : (
              <Typography variant="caption" color="text.secondary" data-testid="settings-inherited-hint">
                Inherited values: {settings.inherited.join(', ')}. Most changed values create a folder override.
              </Typography>
            )}

            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Frame Count
                </Typography>
                <Typography variant="caption">{draft.frames} frames</Typography>
              </Box>
              <Slider
                aria-label="Frame Count"
                data-testid="frames-slider"
                min={1}
                max={10}
                step={1}
                value={draft.frames}
                onChange={(_event, value) =>
                  patch({ frames: Array.isArray(value) ? (value[0] ?? draft.frames) : value })
                }
              />
              <Typography variant="caption">
                Number of frames to extract from each video for analysis.
              </Typography>
            </Box>

            <FormControl fullWidth size="small">
              <InputLabel id="whisper-mode-label">Transcription Mode</InputLabel>
              <Select
                labelId="whisper-mode-label"
                label="Transcription Mode"
                value={draft.whisper_mode}
                data-testid="whisper-mode-select"
                onChange={(event) => {
                  const next = WHISPER_MODE_OPTIONS.find((option) => option.value === event.target.value);
                  if (next !== undefined) patch({ whisper_mode: next.value });
                }}
              >
                {WHISPER_MODE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {draft.whisper_mode === 'local' ? (
              <>
                <FormControl fullWidth size="small" data-testid="whisper-model-control">
                  <InputLabel id="whisper-model-label">Whisper Model</InputLabel>
                  <Select
                    labelId="whisper-model-label"
                    label="Whisper Model"
                    value={draft.whisper_model}
                    data-testid="whisper-model-select"
                    onChange={(event) => {
                      const next = WHISPER_MODEL_OPTIONS.find((option) => option.value === event.target.value);
                      if (next !== undefined) patch({ whisper_model: next.value });
                    }}
                  >
                    {WHISPER_MODEL_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  fullWidth
                  size="small"
                  label="Custom whisper.cpp path"
                  value={draft.whisper_binary_path}
                  onChange={(event) => patch({ whisper_binary_path: event.target.value })}
                  helperText="Optional. Takes precedence over the managed and system runtimes."
                  slotProps={{ htmlInput: { 'data-testid': 'whisper-binary-path' } }}
                />
              </>
            ) : draft.whisper_mode === 'api' ? (
              <TextField
                fullWidth
                size="small"
                label="OpenAI Whisper API key"
                type="password"
                value={settings.whisperApiCredential}
                autoComplete="new-password"
                helperText="Leave blank to keep the stored OpenAI credential."
                onChange={(event) => settings.setWhisperApiCredential(event.target.value)}
              />
            ) : null}

            <SettingsAnalyzerSection
              backend={draft.analyzer_backend}
              localModel={draft.local_model}
              tiers={settings.tiers}
              provider={draft.analyzer_provider}
              frameCount={draft.frames}
              apiCredential={settings.apiCredential}
              onBackendChange={(backend) => patch({ analyzer_backend: backend })}
              onLocalModelChange={(tag) => patch({ local_model: tag })}
              onProviderChange={(provider) => patch({ analyzer_provider: provider })}
              onApiCredentialChange={settings.setApiCredential}
            />

            <FormControl fullWidth size="small">
              <InputLabel id="output-language-label">Description language</InputLabel>
              <Select
                labelId="output-language-label"
                label="Description language"
                value={draft.output_language}
                data-testid="output-language-select"
                onChange={(event) => patch({ output_language: event.target.value })}
              >
                {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Local face grouping (experimental)
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.faces_enabled}
                    data-testid="faces-enabled-switch"
                    onChange={(event) => patch({ faces_enabled: event.target.checked })}
                  />
                }
                label="Enable local face grouping"
              />
              <Typography variant="caption">
                Everything stays on this Mac; face grouping is opt-in; you can delete all face data anytime.
              </Typography>
            </Box>

            <FormControlLabel
              control={
                <Switch
                  checked={draft.skip_rename}
                  data-testid="skip-rename-switch"
                  onChange={(event) => patch({ skip_rename: event.target.checked })}
                />
              }
              label="Skip Auto-Rename"
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {settings.hasChanges ? (
          <Button color="inherit" onClick={settings.reset} disabled={settings.isSaving} data-testid="settings-reset">
            Reset
          </Button>
        ) : null}
        <Button color="inherit" onClick={onClose} disabled={settings.isSaving} data-testid="settings-cancel">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={settings.save}
          disabled={!settings.hasChanges || settings.isSaving || folder === null}
          data-testid="settings-save"
        >
          {settings.isSaving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
