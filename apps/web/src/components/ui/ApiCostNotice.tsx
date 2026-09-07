import { Alert } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatUsd } from '../../lib/format.js';

export const ApiCostNotice = ({
  estimatedCostUsd,
  testId,
}: {
  estimatedCostUsd: number | null;
  testId: string;
}) => {
  const dictionary = useDictionary();
  const message = estimatedCostUsd === null
    ? dictionary.settingsModal.apiCostUsageCharged
    : dictionary.settingsModal.apiCostEstimate(formatUsd(estimatedCostUsd, dictionary.locale));

  return <Alert severity="info" data-testid={testId}>{message}</Alert>;
};
