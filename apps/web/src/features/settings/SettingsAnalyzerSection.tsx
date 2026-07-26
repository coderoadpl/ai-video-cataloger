import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';

import {
  apiCostSignal,
  apiProviderIdForBaseUrl,
  curatedHarnessModels,
  defaultGeminiNativeProvider,
  estimateApiTokens,
  geminiNativeModelIds,
  type AnalyzerProviderConfig,
} from '@core/domain/index.js';

import { HarnessModelPicker } from '../../components/ui/HarnessModelPicker.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import type { CredentialNotice, LocalAiTier, SettingsDraft } from './settings-model.js';

type HarnessProvider = Extract<AnalyzerProviderConfig, { family: 'harness' }>;

const HARNESS_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

const asHarnessEffort = (value: string): (typeof HARNESS_EFFORTS)[number] | undefined =>
  HARNESS_EFFORTS.find((option) => option === value.trim());

const baseHarness = (provider: HarnessProvider): HarnessProvider => ({
  family: 'harness',
  providerId: provider.providerId,
  command: provider.command,
  argsTemplate: provider.argsTemplate,
  promptStyle: provider.promptStyle,
});

const withHarnessModel = (provider: HarnessProvider, model: string): HarnessProvider => ({
  ...baseHarness(provider),
  ...(model.trim().length === 0 ? {} : { model: model.trim() }),
  ...(provider.reasoningEffort === undefined ? {} : { reasoningEffort: provider.reasoningEffort }),
});

const withHarnessEffort = (provider: HarnessProvider, effort: string): HarnessProvider => {
  const reasoningEffort = asHarnessEffort(effort);
  return {
    ...baseHarness(provider),
    ...(provider.model === undefined ? {} : { model: provider.model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
};

type AnalyzerBackend = SettingsDraft['analyzer_backend'];

interface SettingsAnalyzerSectionProps {
  backend: AnalyzerBackend;
  localModel: string;
  tiers: LocalAiTier[] | null;
  provider: AnalyzerProviderConfig;
  frameCount: number;
  apiCredential: string;
  onBackendChange: (backend: AnalyzerBackend) => void;
  onLocalModelChange: (tag: string) => void;
  onProviderChange: (provider: AnalyzerProviderConfig) => void;
  onApiCredentialChange: (credential: string) => void;
  isForgettingCredential: boolean;
  forgetCredentialNotice: CredentialNotice | null;
  onForgetCredential: () => void;
}

export const SettingsAnalyzerSection = ({
  backend,
  localModel,
  tiers,
  provider,
  frameCount,
  apiCredential,
  onBackendChange,
  onLocalModelChange,
  onProviderChange,
  onApiCredentialChange,
  isForgettingCredential,
  forgetCredentialNotice,
  onForgetCredential,
}: SettingsAnalyzerSectionProps) => {
  const dictionary = useDictionary();
  const selectedBackend =
    provider.family === 'gemini-native' ? 'gemini' : provider.family === 'api' ? 'api' : backend;
  const selectedTier = tiers?.find((tier) => tier.tag === localModel) ?? null;
  const showUnsupportedHint =
    backend === 'local' && selectedTier !== null && selectedTier.supportLevel !== 'ok';
  const showNotInstalledHint =
    backend === 'local' && selectedTier !== null && selectedTier.supportLevel === 'ok' && !selectedTier.installed;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="settings-analyzer-section">
      <FormControl fullWidth size="small">
        <InputLabel id="analyzer-backend-label">{dictionary.settingsAnalyzer.aiAnalyzer}</InputLabel>
        <Select
          labelId="analyzer-backend-label"
          label={dictionary.settingsAnalyzer.aiAnalyzer}
          value={selectedBackend}
          data-testid="analyzer-backend-select"
          onChange={(event) => {
            if (event.target.value === 'gemini') {
              onBackendChange('claude');
              onProviderChange(defaultGeminiNativeProvider());
              return;
            }
            if (event.target.value === 'api') {
              onBackendChange('claude');
              onProviderChange(defaultApiProvider());
              return;
            }
            const next = event.target.value === 'local' ? 'local' : 'claude';
            onBackendChange(next);
            onProviderChange(next === 'local' ? {
              family: 'local',
              providerId: 'local',
              modelTag: localModel,
            } : {
              family: 'harness',
              providerId: 'claude-code',
              command: 'claude',
              argsTemplate: ['--add-dir', '{videoDir}', '-p', '{prompt}'],
              promptStyle: 'file-urls',
            });
          }}
        >
          <MenuItem value="claude">{dictionary.settingsAnalyzer.claudeCli}</MenuItem>
          <MenuItem value="local">{dictionary.settingsAnalyzer.localOllama}</MenuItem>
          <MenuItem value="api">{dictionary.settingsAnalyzer.openAiCompatibleApi}</MenuItem>
          <MenuItem value="gemini">{dictionary.settingsAnalyzer.geminiNativeVideo}</MenuItem>
        </Select>
      </FormControl>

      {backend === 'local' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="local-model-label">{dictionary.settingsAnalyzer.localModel}</InputLabel>
            <Select
              labelId="local-model-label"
              label={dictionary.settingsAnalyzer.localModel}
              value={localModel}
              data-testid="local-model-select"
              onChange={(event) => {
                onLocalModelChange(event.target.value);
                onProviderChange({ family: 'local', providerId: 'local', modelTag: event.target.value });
              }}
            >
              {(tiers ?? []).map((tier) => (
                <MenuItem key={tier.tag} value={tier.tag} disabled={tier.supportLevel !== 'ok'}>
                  {tier.tag}
                  {tier.recommended ? dictionary.settingsAnalyzer.recommendedSuffix : ''}
                  {tier.installed ? dictionary.settingsAnalyzer.installedSuffix : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {showUnsupportedHint ? (
            <Typography variant="caption" color="error" data-testid="local-model-unsupported-hint">
              {dictionary.settingsAnalyzer.unsupportedHint}
            </Typography>
          ) : showNotInstalledHint ? (
            <Typography variant="caption" sx={{ color: 'status.pending.main' }} data-testid="local-model-missing-hint">
              {dictionary.settingsAnalyzer.notDownloadedHint}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {provider.family === 'harness' ? (
        <Box data-testid="settings-harness-model">
          <HarnessModelPicker
            harnessId={provider.providerId}
            curatedModels={curatedHarnessModels(provider.providerId)}
            model={provider.model ?? ''}
            onModelChange={(model) => onProviderChange(withHarnessModel(provider, model))}
            effort={provider.reasoningEffort ?? ''}
            onEffortChange={(effort) => onProviderChange(withHarnessEffort(provider, effort))}
          />
        </Box>
      ) : null}

      {provider.family === 'api' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="api-provider-settings">
          <TextField
            size="small"
            label={dictionary.settingsAnalyzer.baseUrl}
            value={provider.baseUrl}
            onChange={(event) => onProviderChange(withApiBaseUrl(provider, event.target.value))}
          />
          <TextField
            size="small"
            label={dictionary.settingsAnalyzer.model}
            value={provider.model}
            onChange={(event) => onProviderChange({ ...provider, model: event.target.value })}
          />
          <CredentialField
            label={dictionary.settingsAnalyzer.apiCredential}
            forgetLabel={dictionary.settingsAnalyzer.forgetCredential}
            credential={apiCredential}
            forgetting={isForgettingCredential}
            notice={forgetCredentialNotice}
            onChange={onApiCredentialChange}
            onForget={onForgetCredential}
          />
          <TextField
            size="small"
            label={dictionary.settingsAnalyzer.inputPrice}
            type="number"
            value={provider.pricePerMTokensInput ?? ''}
            onChange={(event) => onProviderChange(withInputPrice(provider, event.target.value))}
          />
          <TextField
            size="small"
            label={dictionary.settingsAnalyzer.outputPrice}
            type="number"
            value={provider.pricePerMTokensOutput ?? ''}
            onChange={(event) => onProviderChange(withOutputPrice(provider, event.target.value))}
          />
          <Typography variant="caption" data-testid="api-cost-signal">
            {apiCostSignal(provider, estimateApiTokens({ transcriptCharacters: 0, frameCount })).message}
          </Typography>
        </Box>
      ) : null}

      {provider.family === 'gemini-native' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="gemini-provider-settings">
          <FormControl fullWidth size="small">
            <InputLabel id="gemini-model-label">{dictionary.settingsAnalyzer.geminiModel}</InputLabel>
            <Select
              labelId="gemini-model-label"
              label={dictionary.settingsAnalyzer.geminiModel}
              value={provider.model}
              data-testid="gemini-model-select"
              onChange={(event) => onProviderChange(defaultGeminiNativeProvider(event.target.value))}
            >
              {geminiNativeModelIds().map((modelId) => (
                <MenuItem key={modelId} value={modelId}>
                  {modelId}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <CredentialField
            label={dictionary.settingsAnalyzer.apiCredential}
            forgetLabel={dictionary.settingsAnalyzer.forgetCredential}
            credential={apiCredential}
            forgetting={isForgettingCredential}
            notice={forgetCredentialNotice}
            onChange={onApiCredentialChange}
            onForget={onForgetCredential}
          />
          <Typography variant="caption" color="warning.main" data-testid="gemini-privacy-copy">
            {dictionary.settingsAnalyzer.geminiPrivacy}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
};

interface CredentialFieldProps {
  label: string;
  forgetLabel: string;
  credential: string;
  forgetting: boolean;
  notice: CredentialNotice | null;
  onChange: (credential: string) => void;
  onForget: () => void;
}

const CredentialField = ({
  label,
  forgetLabel,
  credential,
  forgetting,
  notice,
  onChange,
  onForget,
}: CredentialFieldProps) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TextField
        size="small"
        fullWidth
        label={label}
        type="password"
        value={credential}
        autoComplete="new-password"
        onChange={(event) => onChange(event.target.value)}
      />
      <Button
        size="small"
        color="error"
        disabled={forgetting}
        data-testid="forget-credential-button"
        onClick={onForget}
      >
        {forgetting ? <CircularProgress size={16} /> : forgetLabel}
      </Button>
    </Box>
    {notice === null ? null : (
      <Alert
        severity={notice.severity}
        variant="outlined"
        data-testid="forget-credential-result"
        data-severity={notice.severity}
      >
        {notice.message}
      </Alert>
    )}
  </Box>
);

const defaultApiProvider = (): Extract<AnalyzerProviderConfig, { family: 'api' }> => ({
  family: 'api',
  providerId: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyRef: 'openai',
  model: 'gpt-4.1-mini',
  maxImageDetail: 'auto',
});

const withApiBaseUrl = (
  provider: Extract<AnalyzerProviderConfig, { family: 'api' }>,
  baseUrl: string,
): Extract<AnalyzerProviderConfig, { family: 'api' }> => {
  const providerId = apiProviderIdForBaseUrl(baseUrl);
  return providerId === null
    ? { ...provider, baseUrl }
    : { ...provider, providerId, apiKeyRef: providerId, baseUrl };
};

const withInputPrice = (
  provider: Extract<AnalyzerProviderConfig, { family: 'api' }>,
  value: string,
): Extract<AnalyzerProviderConfig, { family: 'api' }> => {
  const rest = apiProviderWithoutPrices(provider);
  const withOutput = provider.pricePerMTokensOutput === undefined
    ? rest
    : { ...rest, pricePerMTokensOutput: provider.pricePerMTokensOutput };
  return value.length === 0 ? withOutput : { ...withOutput, pricePerMTokensInput: Number(value) };
};

const withOutputPrice = (
  provider: Extract<AnalyzerProviderConfig, { family: 'api' }>,
  value: string,
): Extract<AnalyzerProviderConfig, { family: 'api' }> => {
  const rest = apiProviderWithoutPrices(provider);
  const withInput = provider.pricePerMTokensInput === undefined
    ? rest
    : { ...rest, pricePerMTokensInput: provider.pricePerMTokensInput };
  return value.length === 0 ? withInput : { ...withInput, pricePerMTokensOutput: Number(value) };
};

const apiProviderWithoutPrices = (
  provider: Extract<AnalyzerProviderConfig, { family: 'api' }>,
): Extract<AnalyzerProviderConfig, { family: 'api' }> => ({
  family: 'api',
  providerId: provider.providerId,
  baseUrl: provider.baseUrl,
  apiKeyRef: provider.apiKeyRef,
  model: provider.model,
  maxImageDetail: provider.maxImageDetail,
});
