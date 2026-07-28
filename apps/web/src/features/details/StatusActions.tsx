import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';

import { PlayCircleIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { type DetailsVideo, isIncomplete } from './details-video.js';
import { type AnalysisPlan } from './index.web.js';
import { variantLabelText } from './VariantSwitcher.js';

interface StatusActionsProps {
  video: DetailsVideo;
  analyzing: boolean;
  onAnalyze?: ((video: DetailsVideo, options?: { force?: boolean }) => void) | undefined;
  disabledReason?: string | undefined;
  analysisPlan?: AnalysisPlan | null | undefined;
}

const spinner = <CircularProgress size={16} color="inherit" />;
const play = <PlayCircleIcon fontSize="small" />;

export const StatusActions = ({ video, analyzing, onAnalyze, disabledReason, analysisPlan }: StatusActionsProps) => {
  const dictionary = useDictionary();

  if (onAnalyze === undefined) return null;
  const run = () => {
    if (analysisPlan?.key === 'existingVariant') {
      onAnalyze(video, { force: true });
      return;
    }
    onAnalyze(video);
  };
  const planLabel = analysisPlan === undefined || analysisPlan === null
    ? null
    : variantLabelText(analysisPlan.label, dictionary);
  const actionLabel = analysisPlan === undefined || analysisPlan === null
    ? null
    : analysisPlan.key === 'newVariant'
      ? dictionary.details.variants.createNewVariant
      : dictionary.details.variants.rerunExistingVariant;
  const planState = analysisPlan === undefined || analysisPlan === null
    ? null
    : analysisPlan.key === 'newVariant'
      ? dictionary.details.variants.newVariant
      : dictionary.details.variants.existingVariant;
  const planHint = planLabel === null || planState === null
    ? null
    : dictionary.details.variants.analysisState(planLabel, planState);

  if (video.status === 'pending' || video.status === 'not_tracked') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Button
          data-testid="analyze-button"
          variant="contained"
          fullWidth
          disabled={analyzing || disabledReason !== undefined}
          startIcon={analyzing ? spinner : play}
          onClick={run}
        >
          {analyzing ? dictionary.details.analyzingButton : actionLabel ?? dictionary.details.analyzeVideo}
        </Button>
        <Typography variant="caption" align="center">
          {disabledReason ?? planHint ?? dictionary.details.analyzeHint}
        </Typography>
      </Box>
    );
  }

  if (isIncomplete(video.status)) {
    return (
      <Alert
        severity="warning"
        icon={false}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        <Typography variant="h2">{dictionary.details.processingIncomplete}</Typography>
        <Typography variant="body2">
          {dictionary.details.incompleteHint}
        </Typography>
        <Button
          data-testid="analyze-button"
          variant="outlined"
          color="inherit"
          fullWidth
          disabled={analyzing || disabledReason !== undefined}
          startIcon={analyzing ? spinner : play}
          onClick={run}
        >
          {analyzing ? dictionary.details.processingButton : actionLabel ?? dictionary.details.continueAnalysis}
        </Button>
        {disabledReason === undefined ? null : (
          <Typography variant="caption">{disabledReason}</Typography>
        )}
        {disabledReason !== undefined || planHint === null ? null : (
          <Typography variant="caption">{planHint}</Typography>
        )}
      </Alert>
    );
  }

  if (video.status === 'error') {
    return (
      <Alert severity="error" icon={false} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h2">{dictionary.details.processingFailed}</Typography>
        {video.errorMessage != null && video.errorMessage.length > 0 ? (
          <Typography variant="body2">{video.errorMessage}</Typography>
        ) : null}
        <Box>
          <Button
            data-testid="analyze-button"
            variant="outlined"
            color="inherit"
            size="small"
            disabled={analyzing || disabledReason !== undefined}
            startIcon={analyzing ? spinner : undefined}
            onClick={run}
          >
            {analyzing ? dictionary.details.retrying : actionLabel ?? dictionary.details.retryAnalysis}
          </Button>
        </Box>
        {disabledReason === undefined ? null : (
          <Typography variant="caption">{disabledReason}</Typography>
        )}
        {disabledReason !== undefined || planHint === null ? null : (
          <Typography variant="caption">{planHint}</Typography>
        )}
      </Alert>
    );
  }

  if (analysisPlan === undefined || analysisPlan === null || actionLabel === null || planHint === null) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Button
        data-testid="analyze-button"
        variant={analysisPlan.key === 'newVariant' ? 'contained' : 'outlined'}
        fullWidth
        disabled={analyzing || disabledReason !== undefined}
        startIcon={analyzing ? spinner : play}
        onClick={run}
      >
        {analyzing ? dictionary.details.analyzingButton : actionLabel}
      </Button>
      <Typography variant="caption" align="center">
        {disabledReason ?? planHint}
      </Typography>
    </Box>
  );
};
