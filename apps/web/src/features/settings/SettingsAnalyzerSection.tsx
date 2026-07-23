import {
  Box,
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
  estimateApiTokens,
  type AnalyzerProviderConfig,
} from '@core/domain/index.js';

import { HarnessModelPicker } from '../../components/ui/HarnessModelPicker.js';
import type { LocalAiTier, SettingsDraft } from './settings-model.js';

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
}: SettingsAnalyzerSectionProps) => {
  const selectedBackend = provider.family === 'api' ? 'api' : backend;
  const selectedTier = tiers?.find((tier) => tier.tag === localModel) ?? null;
  const showUnsupportedHint =
    backend === 'local' && selectedTier !== null && selectedTier.supportLevel !== 'ok';
  const showNotInstalledHint =
    backend === 'local' && selectedTier !== null && selectedTier.supportLevel === 'ok' && !selectedTier.installed;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="settings-analyzer-section">
      <FormControl fullWidth size="small">
        <InputLabel id="analyzer-backend-label">AI Analyzer</InputLabel>
        <Select
          labelId="analyzer-backend-label"
          label="AI Analyzer"
          value={selectedBackend}
          data-testid="analyzer-backend-select"
          onChange={(event) => {
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
          <MenuItem value="claude">Claude (CLI)</MenuItem>
          <MenuItem value="local">Local (Ollama)</MenuItem>
          <MenuItem value="api">OpenAI-compatible API</MenuItem>
        </Select>
      </FormControl>

      {backend === 'local' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="local-model-label">Local model</InputLabel>
            <Select
              labelId="local-model-label"
              label="Local model"
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
                  {tier.recommended ? ' (recommended)' : ''}
                  {tier.installed ? ' — installed' : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {showUnsupportedHint ? (
            <Typography variant="caption" color="error" data-testid="local-model-unsupported-hint">
              This model exceeds what this machine supports.
            </Typography>
          ) : showNotInstalledHint ? (
            <Typography variant="caption" sx={{ color: 'status.pending.main' }} data-testid="local-model-missing-hint">
              This model is not downloaded yet — open the Models manager to download it.
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
            label="Base URL"
            value={provider.baseUrl}
            onChange={(event) => onProviderChange(withApiBaseUrl(provider, event.target.value))}
          />
          <TextField
            size="small"
            label="Model"
            value={provider.model}
            onChange={(event) => onProviderChange({ ...provider, model: event.target.value })}
          />
          <TextField
            size="small"
            label="API credential"
            type="password"
            value={apiCredential}
            autoComplete="new-password"
            onChange={(event) => onApiCredentialChange(event.target.value)}
          />
          <TextField
            size="small"
            label="Input price per 1M tokens"
            type="number"
            value={provider.pricePerMTokensInput ?? ''}
            onChange={(event) => onProviderChange(withInputPrice(provider, event.target.value))}
          />
          <TextField
            size="small"
            label="Output price per 1M tokens"
            type="number"
            value={provider.pricePerMTokensOutput ?? ''}
            onChange={(event) => onProviderChange(withOutputPrice(provider, event.target.value))}
          />
          <Typography variant="caption" data-testid="api-cost-signal">
            {apiCostSignal(provider, estimateApiTokens({ transcriptCharacters: 0, frameCount })).message}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
};

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
