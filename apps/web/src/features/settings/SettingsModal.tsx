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
  UI_LANGUAGE_OPTIONS,
  whisperModelOptions,
  whisperModeOptions,
  type SettingsDraft,
} from './settings-model.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { useSettings } from './use-settings.js';

interface SettingsModalProps {
  open: boolean;
  folder: string | null;
  onClose: () => void;
  onSaved?: (() => void) | undefined;
  onRunWizard?: (() => void) | undefined;
}

export const SettingsModal = ({ open, folder, onClose, onSaved, onRunWizard }: SettingsModalProps) => {
  const settings = useSettings({
    open,
    folder,
    onSaved: () => {
      onSaved?.();
      onClose();
    },
  });
  const { draft } = settings;
  const dictionary = useDictionary();
  const whisperModes = whisperModeOptions(dictionary);
  const nativeAnalyzer = draft?.analyzer_provider.family === 'gemini-native';
  const whisperModels = whisperModelOptions(dictionary);

  const patch = (value: Partial<SettingsDraft>) => settings.setDraft(value);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="settings-modal">
      <DialogTitle>{dictionary.settingsModal.title}</DialogTitle>
      <DialogContent dividers>
        {folder === null ? (
          <DialogContentText data-testid="settings-no-folder">
            {dictionary.settingsModal.selectFolderFirst}
          </DialogContentText>
        ) : settings.isLoading || draft === null ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 4 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">{dictionary.settingsModal.loading}</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, py: 1 }}>
            {settings.error === null ? null : <Alert severity="error">{settings.error}</Alert>}
            {settings.inherited.length === 0 ? null : (
              <Typography variant="caption" color="text.secondary" data-testid="settings-inherited-hint">
                {dictionary.settingsModal.inheritedHint(settings.inherited.join(', '))}
              </Typography>
            )}

            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {dictionary.settingsModal.frameCount}
                </Typography>
                <Typography variant="caption">{dictionary.settingsModal.frameCountValue(draft.frames)}</Typography>
              </Box>
              <Slider
                aria-label={dictionary.settingsModal.frameCount}
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
                {dictionary.settingsModal.frameCountHelper}
              </Typography>
            </Box>

            <FormControl fullWidth size="small">
              <InputLabel id="whisper-mode-label">{dictionary.settingsModal.transcriptionMode}</InputLabel>
              <Select
                labelId="whisper-mode-label"
                label={dictionary.settingsModal.transcriptionMode}
                value={draft.whisper_mode}
                data-testid="whisper-mode-select"
                disabled={nativeAnalyzer}
                onChange={(event) => {
                  const next = whisperModes.find((option) => option.value === event.target.value);
                  if (next !== undefined) patch({ whisper_mode: next.value });
                }}
              >
                {whisperModes.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {nativeAnalyzer ? (
              <Typography variant="caption" data-testid="whisper-mode-native-notice">
                {dictionary.wizard.transcription.nativeSkipNotice}
              </Typography>
            ) : null}

            {draft.whisper_mode === 'local' ? (
              <>
                <FormControl fullWidth size="small" data-testid="whisper-model-control">
                  <InputLabel id="whisper-model-label">{dictionary.settingsModal.whisperModel}</InputLabel>
                  <Select
                    labelId="whisper-model-label"
                    label={dictionary.settingsModal.whisperModel}
                    value={draft.whisper_model}
                    data-testid="whisper-model-select"
                    onChange={(event) => {
                      const next = whisperModels.find((option) => option.value === event.target.value);
                      if (next !== undefined) patch({ whisper_model: next.value });
                    }}
                  >
                    {whisperModels.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  fullWidth
                  size="small"
                  label={dictionary.settingsModal.customWhisperPath}
                  value={draft.whisper_binary_path}
                  onChange={(event) => patch({ whisper_binary_path: event.target.value })}
                  helperText={dictionary.settingsModal.customWhisperPathHelper}
                  slotProps={{ htmlInput: { 'data-testid': 'whisper-binary-path' } }}
                />
              </>
            ) : draft.whisper_mode === 'api' ? (
              <TextField
                fullWidth
                size="small"
                label={dictionary.settingsModal.openAiWhisperApiKey}
                type="password"
                value={settings.whisperApiCredential}
                autoComplete="new-password"
                helperText={dictionary.settingsModal.openAiWhisperApiKeyHelper}
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
              onProviderChange={(provider) =>
                patch(provider.family === 'gemini-native'
                  ? { analyzer_provider: provider, whisper_mode: 'skip' }
                  : { analyzer_provider: provider })}
              onApiCredentialChange={settings.setApiCredential}
              isForgettingCredential={settings.isForgettingCredential}
              forgetCredentialMessage={settings.forgetCredentialMessage}
              onForgetCredential={settings.forgetCredential}
            />

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {dictionary.settings.languageSectionTitle}
              </Typography>
              <FormControl fullWidth size="small">
                <InputLabel id="ui-language-label">{dictionary.language.uiLabel}</InputLabel>
                <Select
                  labelId="ui-language-label"
                  label={dictionary.language.uiLabel}
                  value={draft.ui_language}
                  data-testid="ui-language-select"
                  onChange={(event) => patch({ ui_language: event.target.value === 'pl' ? 'pl' : 'en' })}
                >
                  {UI_LANGUAGE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.value === 'pl' ? dictionary.language.optionPolish : dictionary.language.optionEnglish}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="output-language-label">{dictionary.language.outputLabel}</InputLabel>
                <Select
                  labelId="output-language-label"
                  label={dictionary.language.outputLabel}
                  value={draft.output_language}
                  data-testid="output-language-select"
                  onChange={(event) => patch({ output_language: event.target.value })}
                >
                  {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.value === 'auto'
                        ? dictionary.language.optionAuto
                        : option.value === 'pl'
                          ? dictionary.language.optionPolish
                          : dictionary.language.optionEnglish}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {dictionary.settingsModal.facesSectionTitle}
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.faces_enabled}
                    data-testid="faces-enabled-switch"
                    onChange={(event) => patch({ faces_enabled: event.target.checked })}
                  />
                }
                label={dictionary.settingsModal.facesEnableLabel}
              />
              <Typography variant="caption">
                {dictionary.settingsModal.facesHelper}
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
              label={dictionary.settingsModal.skipAutoRename}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {onRunWizard === undefined ? null : (
          <Button
            color="inherit"
            onClick={onRunWizard}
            disabled={settings.isSaving}
            data-testid="settings-run-wizard"
            sx={{ mr: 'auto' }}
          >
            {dictionary.settingsModal.runSetupWizard}
          </Button>
        )}
        {settings.hasChanges ? (
          <Button color="inherit" onClick={settings.reset} disabled={settings.isSaving} data-testid="settings-reset">
            {dictionary.settingsModal.reset}
          </Button>
        ) : null}
        <Button color="inherit" onClick={onClose} disabled={settings.isSaving} data-testid="settings-cancel">
          {dictionary.common.cancel}
        </Button>
        <Button
          variant="contained"
          onClick={settings.save}
          disabled={!settings.hasChanges || settings.isSaving || folder === null}
          data-testid="settings-save"
        >
          {settings.isSaving ? dictionary.settingsModal.saving : dictionary.common.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
