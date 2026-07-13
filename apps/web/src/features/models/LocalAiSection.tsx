import { Alert, Box, Button, Chip, CircularProgress, LinearProgress, Typography } from '@mui/material';

import { tierSupportBadge, type LocalAiTier } from './models-model.js';
import type { LocalAiState } from './use-local-ai.js';

interface LocalAiSectionProps {
  state: LocalAiState;
}

/**
 * The Local AI (Ollama) section embedded in the Model Manager
 * (parity-inventory §2): machine summary with the recommended model, tier rows
 * with hardware-compatibility badges, download-with-progress for supported and
 * missing tiers, and delete for installed ones.
 */
export const LocalAiSection = ({ state }: LocalAiSectionProps) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="local-ai-section">
    <Box>
      <Typography variant="h2">Local AI models (Ollama)</Typography>
      <Typography variant="caption">
        Used by the Local analyzer. The runtime installs and starts automatically.
      </Typography>
    </Box>

    {state.machine !== null ? (
      <Typography variant="caption" data-testid="local-ai-machine">
        Your Mac:{' '}
        {state.machine.appleSilicon
          ? 'Apple Silicon'
          : `${state.machine.platform}/${state.machine.arch}`}
        , {state.machine.totalMemGB} GB RAM
        {state.recommendedTag === null ? null : <> — recommended: {state.recommendedTag}</>}
      </Typography>
    ) : null}

    {state.isLoading ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="body2">Loading local AI models…</Typography>
      </Box>
    ) : null}
    {state.error === null ? null : <Alert severity="error">{state.error}</Alert>}

    {state.tiers === null
      ? null
      : state.tiers.map((tier) => (
          <LocalAiTierRow
            key={tier.tag}
            tier={tier}
            pulling={state.pullProgress?.tag === tier.tag}
            pullPercentage={state.pullProgress?.tag === tier.tag ? state.pullProgress.percentage : null}
            removing={state.removingTag === tier.tag}
            disabled={state.isBusy}
            onDownload={() => state.pull(tier)}
            onDelete={() => state.remove(tier)}
          />
        ))}
  </Box>
);

interface LocalAiTierRowProps {
  tier: LocalAiTier;
  pulling: boolean;
  pullPercentage: number | null;
  removing: boolean;
  disabled: boolean;
  onDownload: () => void;
  onDelete: () => void;
}

const LocalAiTierRow = ({
  tier,
  pulling,
  pullPercentage,
  removing,
  disabled,
  onDownload,
  onDelete,
}: LocalAiTierRowProps) => {
  const badge = tierSupportBadge(tier);
  const canDownload = tier.supportLevel === 'ok' && !tier.installed && !disabled;

  return (
    <Box
      data-testid="local-ai-tier-row"
      data-tier-tag={tier.tag}
      data-tier-installed={tier.installed ? 'true' : 'false'}
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, p: 1.25, borderRadius: 1, border: 1, borderColor: 'divider' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {tier.tag}
            {tier.recommended ? (
              <Typography component="span" variant="caption" sx={{ ml: 1, color: 'status.completed.main' }}>
                (recommended)
              </Typography>
            ) : null}
          </Typography>
          <Typography variant="caption">
            {tier.label} · {tier.downloadGB} GB download
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <Chip
            size="small"
            label={badge.text}
            sx={{ bgcolor: `status.${badge.token}.soft`, color: `status.${badge.token}.main` }}
          />
          {tier.installed ? (
            <Button
              size="small"
              color="inherit"
              disabled={disabled}
              data-testid="local-ai-delete-button"
              onClick={onDelete}
            >
              {removing ? <CircularProgress size={16} /> : 'Delete'}
            </Button>
          ) : (
            <Button
              size="small"
              variant="contained"
              disabled={!canDownload}
              data-testid="local-ai-download-button"
              onClick={onDownload}
            >
              {pulling ? 'Downloading' : 'Download'}
            </Button>
          )}
        </Box>
      </Box>
      {pullPercentage !== null ? (
        <Box data-testid="local-ai-progress">
          <LinearProgress variant="determinate" value={pullPercentage} />
          <Typography variant="caption">{pullPercentage}%</Typography>
        </Box>
      ) : null}
    </Box>
  );
};
