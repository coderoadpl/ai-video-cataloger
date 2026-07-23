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
} from '@core/domain/index.js';

import { HarnessModelPicker } from '../../components/ui/HarnessModelPicker.js';
import { buildApiProvider } from './wizard-model.js';
import type { WizardController } from './use-wizard.js';

const availabilityChip = (status: 'unknown' | 'available' | 'unavailable', version: string | null) => {
  switch (status) {
    case 'available':
      return <Chip size="small" label={version === null ? 'Installed' : `Installed · ${version}`} color="success" />;
    case 'unavailable':
      return <Chip size="small" label="Not detected" color="error" variant="outlined" />;
    case 'unknown':
      return <Chip size="small" label="Checking…" variant="outlined" />;
  }
};

export const AnalyzerStep = ({ controller }: { controller: WizardController }) => {
  const { analyzerFamily, machine, tiers, apiDraft } = controller;
  const costSignal = apiCostSignal(buildApiProvider(apiDraft), estimateApiTokens({ transcriptCharacters: 0, frameCount: 3 }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="wizard-step-analyzer">
      <Typography variant="h2">Choose an analyzer</Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={analyzerFamily}
        onChange={(_event, value: unknown) => {
          if (value === 'local' || value === 'api' || value === 'harness') controller.setAnalyzerFamily(value);
        }}
        aria-label="analyzer family"
      >
        <ToggleButton value="local" data-testid="analyzer-family-local">
          Local{machine?.appleSilicon === true ? ' (recommended)' : ''}
        </ToggleButton>
        <ToggleButton value="api" data-testid="analyzer-family-api">
          API
        </ToggleButton>
        <ToggleButton value="harness" data-testid="analyzer-family-harness">
          Agent harness
        </ToggleButton>
      </ToggleButtonGroup>

      {analyzerFamily === 'local' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }} data-testid="analyzer-local">
          {machine?.appleSilicon === false ? (
            <Alert severity="warning">Local models need Apple Silicon; pick API or a harness on this machine.</Alert>
          ) : null}
          <FormControl fullWidth size="small">
            <InputLabel id="wizard-local-model">Local model</InputLabel>
            <Select
              labelId="wizard-local-model"
              label="Local model"
              value={tiers.some((tier) => tier.tag === controller.localModelTag) ? controller.localModelTag : ''}
              data-testid="wizard-local-model-select"
              onChange={(event) => controller.setLocalModelTag(event.target.value)}
            >
              {tiers.map((tier) => (
                <MenuItem key={tier.tag} value={tier.tag} disabled={tier.supportLevel !== 'ok'}>
                  {tier.label}
                  {tier.recommended ? ' — recommended for this Mac' : ''}
                  {tier.installed ? ' (installed)' : ` · ${tier.downloadGB} GB download`}
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
            label="Base URL"
            value={apiDraft.baseUrl}
            onChange={(event) => controller.setApiDraft({ baseUrl: event.target.value })}
          />
          <TextField
            size="small"
            label="Model"
            value={apiDraft.model}
            onChange={(event) => controller.setApiDraft({ model: event.target.value })}
          />
          <TextField
            size="small"
            type="password"
            label="API key"
            autoComplete="new-password"
            value={apiDraft.credential}
            onChange={(event) => controller.setApiDraft({ credential: event.target.value })}
          />
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField
              size="small"
              type="number"
              label="Input price / 1M tokens"
              value={apiDraft.pricePerMTokensInput}
              onChange={(event) => controller.setApiDraft({ pricePerMTokensInput: event.target.value })}
            />
            <TextField
              size="small"
              type="number"
              label="Output price / 1M tokens"
              value={apiDraft.pricePerMTokensOutput}
              onChange={(event) => controller.setApiDraft({ pricePerMTokensOutput: event.target.value })}
            />
          </Box>
          <Alert severity="info" data-testid="api-cost-notice">
            {costSignal.kind === 'estimate' ? costSignal.message : API_USAGE_CHARGE_NOTICE}
          </Alert>
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
                {availabilityChip(availability.status, availability.version)}
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
