import { Box, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import type { ErrorCode } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { WarningIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';

export interface DurabilityIndicatorViewProps {
  lastErrorCode: ErrorCode | null;
}

export const DurabilityIndicatorView = ({ lastErrorCode }: DurabilityIndicatorViewProps) => {
  const dictionary = useDictionary();
  return (
    <Tooltip title={dictionary.durability.indicatorDetail}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: 200, color: 'warning.main' }}
        data-testid="durability-indicator"
        data-error-code={lastErrorCode ?? ''}
        role="status"
        aria-live="polite"
      >
        <WarningIcon fontSize="small" />
        <Typography variant="caption" noWrap>{dictionary.durability.indicatorLabel}</Typography>
      </Box>
    </Tooltip>
  );
};

export const DURABILITY_REFETCH_INTERVAL_MS = 15_000;

export const DurabilityIndicator = () => {
  const index = useQuery({ ...actions.indexStatus, refetchInterval: DURABILITY_REFETCH_INTERVAL_MS });
  const photos = useQuery({ ...actions.photosStatus(), refetchInterval: DURABILITY_REFETCH_INTERVAL_MS });
  const degraded = [index.data?.durability, photos.data?.durability].find((status) => status?.degraded === true);
  if (degraded === undefined) return null;
  return <DurabilityIndicatorView lastErrorCode={degraded.lastErrorCode} />;
};
