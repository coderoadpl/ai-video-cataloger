import {
  Alert,
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import {
  API_USAGE_CHARGE_NOTICE,
  apiCostSignal,
  curatedHarnessModels,
  estimateApiTokens,
  geminiNativeModelIds,
} from '@core/domain/index.js';

import { HarnessModelPicker } from '../../components/ui/HarnessModelPicker.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { buildApiProvider } from './wizard-model.js';
import type { WizardController } from './use-wizard.js';

const availabilityChip = (
  dictionary: Dictionary,
  status: 'unknown' | 'available' | 'unavailable',
  version: string | null,
) => {
  switch (status) {
    case 'available':
      return (
        <Chip
          size="small"
          label={version === null ? dictionary.wizard.analyzer.installed : dictionary.wizard.analyzer.installedVersion(version)}
          color="success"
        />
      );
    case 'unavailable':
      return <Chip size="small" label={dictionary.wizard.analyzer.notDetected} color="error" variant="outlined" />;
    case 'unknown':
      return <Chip size="small" label={dictionary.wizard.analyzer.checking} variant="outlined" />;
  }
};

export const AnalyzerStep = ({ controller }: { controller: WizardController }) => {
  const dictionary = useDictionary();
  const { analyzerFamily, machine, tiers, apiDraft, geminiDraft } = controller;
  const costSignal = apiCostSignal(buildApiProvider(apiDraft), estimateApiTokens({ transcriptCharacters: 0, frameCount: 3 }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="wizard-step-analyzer">
      <Typography variant="h2">{dictionary.wizard.analyzer.title}</Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={analyzerFamily}
        onChange={(_event, value: unknown) => {
          if (value === 'local' || value === 'api' || value === 'harness' || value === 'gemini-native') {
            controller.setAnalyzerFamily(value);
          }
        }}
        aria-label={dictionary.wizard.analyzer.familyLabel}
      >
        <ToggleButton value="local" data-testid="analyzer-family-local">
          {dictionary.wizard.analyzer.local}
          {machine?.appleSilicon === true ? dictionary.wizard.analyzer.recommendedSuffix : ''}
        </ToggleButton>
        <ToggleButton value="api" data-testid="analyzer-family-api">
          {dictionary.wizard.analyzer.api}
        </ToggleButton>
        <ToggleButton value="gemini-native" data-testid="analyzer-family-gemini">
          {dictionary.wizard.analyzer.gemini}
        </ToggleButton>
        <ToggleButton value="harness" data-testid="analyzer-family-harness">
          {dictionary.wizard.analyzer.harness}
        </ToggleButton>
      </ToggleButtonGroup>

      <Alert severity="warning" data-testid="wizard-gemini-privacy">
        {dictionary.wizard.analyzer.geminiPrivacy}
      </Alert>

      {analyzerFamily === 'local' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }} data-testid="analyzer-local">
          {machine?.appleSilicon === false ? (
            <Alert severity="warning">{dictionary.wizard.analyzer.localAppleSiliconWarning}</Alert>
          ) : null}
          <FormControl fullWidth size="small">
            <InputLabel id="wizard-local-model">{dictionary.wizard.analyzer.localModel}</InputLabel>
            <Select
              labelId="wizard-local-model"
              label={dictionary.wizard.analyzer.localModel}
              value={tiers.some((tier) => tier.tag === controller.localModelTag) ? controller.localModelTag : ''}
              data-testid="wizard-local-model-select"
              onChange={(event) => controller.setLocalModelTag(event.target.value)}
            >
              {tiers.map((tier) => (
                <MenuItem key={tier.tag} value={tier.tag} disabled={tier.supportLevel !== 'ok'}>
                  {tier.label}
                  {tier.recommended ? dictionary.wizard.analyzer.recommendedForThisMac : ''}
                  {tier.installed ? dictionary.wizard.analyzer.installedSuffix : dictionary.wizard.analyzer.downloadGb(tier.downloadGB)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      ) : null}

      {analyzerFamily === 'api' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="analyzer-api">
          <TextField
            size="small"
            label={dictionary.wizard.analyzer.baseUrl}
            value={apiDraft.baseUrl}
            onChange={(event) => controller.setApiDraft({ baseUrl: event.target.value })}
          />
          <TextField
            size="small"
            label={dictionary.wizard.analyzer.model}
            value={apiDraft.model}
            onChange={(event) => controller.setApiDraft({ model: event.target.value })}
          />
          <TextField
            size="small"
            type="password"
            label={dictionary.wizard.analyzer.apiKey}
            autoComplete="new-password"
            value={apiDraft.credential}
            onChange={(event) => controller.setApiDraft({ credential: event.target.value })}
          />
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField
              size="small"
              type="number"
              label={dictionary.wizard.analyzer.inputPrice}
              value={apiDraft.pricePerMTokensInput}
              onChange={(event) => controller.setApiDraft({ pricePerMTokensInput: event.target.value })}
            />
            <TextField
              size="small"
              type="number"
              label={dictionary.wizard.analyzer.outputPrice}
              value={apiDraft.pricePerMTokensOutput}
              onChange={(event) => controller.setApiDraft({ pricePerMTokensOutput: event.target.value })}
            />
          </Box>
          <Alert severity="info" data-testid="api-cost-notice">
            {costSignal.kind === 'estimate' ? costSignal.message : API_USAGE_CHARGE_NOTICE}
          </Alert>
        </Box>
      ) : null}

      {analyzerFamily === 'gemini-native' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="analyzer-gemini">
          <FormControl fullWidth size="small">
            <InputLabel id="wizard-gemini-model">{dictionary.wizard.analyzer.geminiModel}</InputLabel>
            <Select
              labelId="wizard-gemini-model"
              label={dictionary.wizard.analyzer.geminiModel}
              value={geminiDraft.model}
              data-testid="wizard-gemini-model-select"
              onChange={(event) => controller.setGeminiDraft({ model: event.target.value })}
            >
              {geminiNativeModelIds().map((modelId) => (
                <MenuItem key={modelId} value={modelId}>
                  {modelId}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            type="password"
            label={dictionary.wizard.analyzer.apiKey}
            autoComplete="new-password"
            value={geminiDraft.credential}
            onChange={(event) => controller.setGeminiDraft({ credential: event.target.value })}
          />
        </Box>
      ) : null}

      {analyzerFamily === 'harness' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="analyzer-harness">
          {controller.harnesses.map((descriptor) => {
            const availability = controller.harnessAvailability[descriptor.providerId] ?? {
              status: 'unknown' as const,
              version: null,
            };
            return (
              <ToggleButton
                key={descriptor.providerId}
                value={descriptor.providerId}
                selected={controller.harnessId === descriptor.providerId}
                onChange={() => controller.setHarnessId(descriptor.providerId)}
                size="small"
                sx={{ justifyContent: 'space-between', textTransform: 'none' }}
                data-testid={`harness-${descriptor.providerId}`}
              >
                <span>{descriptor.label}</span>
                {availabilityChip(dictionary, availability.status, availability.version)}
              </ToggleButton>
            );
          })}
          <HarnessModelPicker
            harnessId={controller.harnessId}
            curatedModels={curatedHarnessModels(controller.harnessId)}
            model={controller.harnessModel}
            onModelChange={controller.setHarnessModel}
            effort={controller.harnessEffort}
            onEffortChange={controller.setHarnessEffort}
          />
        </Box>
      ) : null}

      {controller.validation === 'error' && controller.validationMessage !== null ? (
        <Alert severity="error" data-testid="analyzer-validation-error">
          {controller.validationMessage}
        </Alert>
      ) : null}
    </Box>
  );
};
