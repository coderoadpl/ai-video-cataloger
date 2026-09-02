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

import { SettingsBackupSection } from './SettingsBackupSection.js';
import { SettingsAnalyzerSection } from './SettingsAnalyzerSection.js';
import {
  UI_LANGUAGE_OPTIONS,
  languageOptionLabel,
  languageOptionsWith,
  whisperModelOptions,
  whisperModeOptions,
  type SettingsDraft,
} from './settings-model.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
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
            {settings.error === null ? null : <Alert severity="error">{formatAnalyzerError(settings.error, dictionary.errors)}</Alert>}

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
              forgetCredentialNotice={settings.forgetCredentialNotice}
              onForgetCredential={settings.forgetCredential}
            />

            {nativeAnalyzer ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="gemini-budget-section">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {dictionary.settingsModal.geminiBudgetSectionTitle}
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  label={dictionary.settingsModal.geminiBudgetLabel}
                  value={settings.budgetInput}
                  error={settings.isBudgetInvalid}
                  onChange={(event) => settings.setBudgetInput(event.target.value)}
                  helperText={settings.isBudgetInvalid
                    ? dictionary.settingsModal.geminiBudgetInvalid
                    : dictionary.settingsModal.geminiBudgetHelper}
                  slotProps={{ htmlInput: { 'data-testid': 'gemini-budget-input', inputMode: 'decimal' } }}
                />
                {settings.monthlySpend === null ? (
                  <Typography variant="caption" data-testid="gemini-spend-readout">
                    {dictionary.settingsModal.geminiSpendUnknown}
                  </Typography>
                ) : settings.monthlySpend.estimatedCostUsd === 0 && settings.monthlySpend.entries === 0 ? null : (
                  <Typography variant="caption" data-testid="gemini-spend-readout">
                    {dictionary.settingsModal.geminiSpendReadout(
                      settings.monthlySpend.month,
                      settings.monthlySpend.estimatedCostUsd,
                      settings.monthlySpend.entries,
                    )}
                  </Typography>
                )}
              </Box>
            ) : null}

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

            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {dictionary.settingsModal.analyzerTimeout}
                </Typography>
                <Typography variant="caption">{dictionary.settingsModal.secondsValue(draft.timeout)}</Typography>
              </Box>
              <Slider
                aria-label={dictionary.settingsModal.analyzerTimeout}
                data-testid="analyzer-timeout-slider"
                min={30}
                max={600}
                step={10}
                value={draft.timeout}
                onChange={(_event, value) =>
                  patch({ timeout: Array.isArray(value) ? (value[0] ?? draft.timeout) : value })
                }
              />
              <Typography variant="caption">
                {dictionary.settingsModal.analyzerTimeoutHelper}
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
                  <MenuItem key={option.value} value={option.value} data-testid={`whisper-mode-option-${option.value}`}>
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

            <FormControl fullWidth size="small">
              <InputLabel id="whisper-language-label">{dictionary.settingsModal.transcriptionLanguage}</InputLabel>
              <Select
                labelId="whisper-language-label"
                label={dictionary.settingsModal.transcriptionLanguage}
                value={draft.whisper_language}
                data-testid="whisper-language-select"
                disabled={nativeAnalyzer}
                onChange={(event) => patch({ whisper_language: event.target.value })}
              >
                {languageOptionsWith(draft.whisper_language).map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {languageOptionLabel(dictionary, option.value)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

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
              <>
                <TextField
                  fullWidth
                  size="small"
                  label={dictionary.settingsModal.whisperApiBaseUrl}
                  value={draft.whisper_api_base_url}
                  onChange={(event) => patch({ whisper_api_base_url: event.target.value })}
                  helperText={dictionary.settingsModal.whisperApiBaseUrlHelper}
                  slotProps={{ htmlInput: { 'data-testid': 'whisper-api-base-url' } }}
                />
                <TextField
                  fullWidth
                  size="small"
                  label={dictionary.settingsModal.whisperApiModel}
                  value={draft.whisper_api_model}
                  onChange={(event) => patch({ whisper_api_model: event.target.value })}
                  slotProps={{ htmlInput: { 'data-testid': 'whisper-api-model' } }}
                />
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
              </>
            ) : null}

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
                      {languageOptionLabel(dictionary, option.value)}
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
                  {languageOptionsWith(draft.output_language).map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {languageOptionLabel(dictionary, option.value)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="tag-language-label">{dictionary.language.tagLabel}</InputLabel>
                <Select
                  labelId="tag-language-label"
                  label={dictionary.language.tagLabel}
                  value={draft.tag_language}
                  data-testid="tag-language-select"
                  onChange={(event) => patch({ tag_language: event.target.value })}
                >
                  {languageOptionsWith(draft.tag_language).map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {languageOptionLabel(dictionary, option.value)}
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

            {nativeAnalyzer ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {dictionary.settingsModal.geminiBatchSectionTitle}
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={draft.gemini_batch_mode}
                      data-testid="gemini-batch-switch"
                      onChange={(event) => patch({ gemini_batch_mode: event.target.checked })}
                    />
                  }
                  label={dictionary.settingsModal.geminiBatchEnableLabel}
                />
                <Typography variant="caption">
                  {dictionary.settingsModal.geminiBatchHelper}
                </Typography>
              </Box>
            ) : null}

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
        <Box sx={{ pt: 3 }}>
          <SettingsBackupSection open={open} />
        </Box>
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
        {settings.isSaving && settings.isSaveSlow ? (
          <Typography variant="caption" color="text.secondary" data-testid="settings-saving-hint">
            {dictionary.settingsModal.savingKeychainHint}
          </Typography>
        ) : null}
        <Button color="inherit" onClick={onClose} disabled={settings.isSaving} data-testid="settings-cancel">
          {dictionary.common.cancel}
        </Button>
        <Button
          variant="contained"
          onClick={settings.save}
          disabled={!settings.canSave || settings.isSaving || folder === null}
          data-testid="settings-save"
        >
          {settings.isSaving ? dictionary.settingsModal.saving : dictionary.common.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
