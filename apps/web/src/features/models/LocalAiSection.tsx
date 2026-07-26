import { Alert, Box, Button, Chip, CircularProgress, LinearProgress, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { tierSupportBadge, type LocalAiTier } from './models-model.js';
import type { LocalAiState } from './use-local-ai.js';

interface LocalAiSectionProps {
  state: LocalAiState;
}

export const LocalAiSection = ({ state }: LocalAiSectionProps) => {
  const dictionary = useDictionary();

  return (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="local-ai-section">
    <Box>
      <Typography variant="h2">{dictionary.models.localAiTitle}</Typography>
      <Typography variant="caption">
        {dictionary.models.localAiDescription}
      </Typography>
    </Box>

    {state.machine !== null ? (
      <Typography variant="caption" data-testid="local-ai-machine">
        {dictionary.models.yourMac}:{' '}
        {state.machine.appleSilicon
          ? dictionary.models.appleSilicon
          : `${state.machine.platform}/${state.machine.arch}`}
        , {state.machine.totalMemGB} GB RAM
        {state.recommendedTag === null ? null : <> — {dictionary.models.recommended}: {state.recommendedTag}</>}
      </Typography>
    ) : null}

    {state.isLoading ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="body2">{dictionary.models.loadingLocalAi}</Typography>
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
            dictionary={dictionary}
          />
        ))}
  </Box>
  );
};

interface LocalAiTierRowProps {
  tier: LocalAiTier;
  pulling: boolean;
  pullPercentage: number | null;
  removing: boolean;
  disabled: boolean;
  onDownload: () => void;
  onDelete: () => void;
  dictionary: ReturnType<typeof useDictionary>;
}

const LocalAiTierRow = ({
  tier,
  pulling,
  pullPercentage,
  removing,
  disabled,
  onDownload,
  onDelete,
  dictionary,
}: LocalAiTierRowProps) => {
  const badge = tierSupportBadge(dictionary, tier);
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
                ({dictionary.models.recommended})
              </Typography>
            ) : null}
          </Typography>
          <Typography variant="caption">
            {tier.label} · {dictionary.models.downloadGb(tier.downloadGB)}
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
              color="error"
              disabled={disabled}
              data-testid="local-ai-delete-button"
              onClick={onDelete}
            >
              {removing ? <CircularProgress size={16} /> : dictionary.models.delete}
            </Button>
          ) : (
            <Button
              size="small"
              variant="contained"
              disabled={!canDownload}
              data-testid="local-ai-download-button"
              onClick={onDownload}
            >
              {pulling ? dictionary.models.downloading : dictionary.models.download}
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
