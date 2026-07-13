import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';

import type { LocalAiTier, SettingsDraft } from './settings-model.js';

type AnalyzerBackend = SettingsDraft['analyzer_backend'];

interface SettingsAnalyzerSectionProps {
  backend: AnalyzerBackend;
  localModel: string;
  tiers: LocalAiTier[] | null;
  onBackendChange: (backend: AnalyzerBackend) => void;
  onLocalModelChange: (tag: string) => void;
}

/**
 * The "AI Analyzer" section of the Settings modal (parity-inventory §2): the
 * backend picker (Claude CLI vs local Ollama) and, for the local backend, a
 * model picker over the hardware tiers with unsupported tiers disabled and a
 * hint when the chosen model is unsupported or not yet installed. These keys are
 * real — the processing pipeline reads them per folder.
 */
export const SettingsAnalyzerSection = ({
  backend,
  localModel,
  tiers,
  onBackendChange,
  onLocalModelChange,
}: SettingsAnalyzerSectionProps) => {
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
          value={backend}
          data-testid="analyzer-backend-select"
          onChange={(event) => onBackendChange(event.target.value === 'local' ? 'local' : 'claude')}
        >
          <MenuItem value="claude">Claude (CLI)</MenuItem>
          <MenuItem value="local">Local (Ollama)</MenuItem>
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
              onChange={(event) => onLocalModelChange(event.target.value)}
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
    </Box>
  );
};
