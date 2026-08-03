import { Box, Button, CircularProgress, Paper, Typography } from '@mui/material';

import { ErrorIcon, PlayCircleIcon, WarningIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { CardHeader } from '../../components/ui/CardHeader.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import { type DetailsVideo, isIncomplete } from './details-video.js';
import { type AnalysisPlan } from './index.web.js';
import { variantLabelText } from './variant-label.js';

interface StatusActionsProps {
  video: DetailsVideo;
  analyzing: boolean;
  onAnalyze?: ((video: DetailsVideo, options?: { force?: boolean }) => void) | undefined;
  disabledReason?: string | undefined;
  analysisPlan?: AnalysisPlan | null | undefined;
  variantCount?: number;
}

const spinner = <CircularProgress size={16} color="inherit" />;
const play = <PlayCircleIcon fontSize="small" />;

export const StatusActions = ({ video, analyzing, onAnalyze, disabledReason, analysisPlan, variantCount = 0 }: StatusActionsProps) => {
  const dictionary = useDictionary();

  if (onAnalyze === undefined) return null;
  const run = () => {
    if (analysisPlan?.key === 'existingVariant') {
      onAnalyze(video, { force: true });
      return;
    }
    onAnalyze(video);
  };
  const hasNoVariants = variantCount === 0;
  const planLabel = analysisPlan === undefined || analysisPlan === null
    ? null
    : variantLabelText(analysisPlan.label, dictionary);
  const actionLabel = analysisPlan === undefined || analysisPlan === null
    ? null
    : hasNoVariants
      ? dictionary.details.analyzeAction
      : analysisPlan.key === 'newVariant'
        ? dictionary.details.variants.createNewVariant
        : dictionary.details.variants.rerunExistingVariant;
  const planState = analysisPlan === undefined || analysisPlan === null
    ? null
    : analysisPlan.key === 'newVariant'
      ? dictionary.details.variants.newVariant
      : dictionary.details.variants.existingVariant;
  const planHint = hasNoVariants || planLabel === null || planState === null
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
      <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <CardHeader
          icon={<WarningIcon fontSize="small" sx={{ color: 'status.pending.main' }} />}
          title={dictionary.details.processingIncomplete}
        />
        <Typography variant="body2">
          {dictionary.details.incompleteHint}
        </Typography>
        <Button
          data-testid="analyze-button"
          variant="contained"
          fullWidth
          disabled={analyzing || disabledReason !== undefined}
          startIcon={analyzing ? spinner : play}
          onClick={run}
        >
          {analyzing ? dictionary.details.processingButton : actionLabel ?? dictionary.details.continueAnalysis}
        </Button>
        {disabledReason === undefined ? null : (
          <Typography variant="caption" align="center">{disabledReason}</Typography>
        )}
        {disabledReason !== undefined || planHint === null ? null : (
          <Typography variant="caption" align="center">{planHint}</Typography>
        )}
      </Paper>
    );
  }

  if (video.status === 'error') {
    return (
      <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <CardHeader
          icon={<ErrorIcon fontSize="small" sx={{ color: 'status.error.main' }} />}
          title={dictionary.details.processingFailed}
        />
        {video.errorMessage != null && video.errorMessage.length > 0 ? (
          <Typography variant="body2">{formatAnalyzerError(video.errorMessage, dictionary.errors)}</Typography>
        ) : null}
        <Box>
          <Button
            data-testid="analyze-button"
            variant="outlined"
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
      </Paper>
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
