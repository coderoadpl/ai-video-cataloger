import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

import { useDictionary } from '../../../i18n/use-dictionary.js';

export interface DriveSummaryCounts {
  foldersDone: number;
  filesDone: number;
  filesSkipped: number;
  filesDuplicateSkipped: number;
  filesFailed: number;
  estimatedCostUsd: number | null;
  costedFiles: number;
}

interface DriveSummaryDialogProps {
  open: boolean;
  counts: DriveSummaryCounts | null;
  onClose: () => void;
}

const Stat = ({ testId, value, label }: { testId: string; value: number | string; label: string }) => (
  <Typography variant="body2">
    <Box component="span" data-testid={testId} sx={{ fontWeight: 600 }}>
      {value}
    </Box>{' '}
    {label}
  </Typography>
);

export const DriveSummaryDialog = ({ open, counts, onClose }: DriveSummaryDialogProps) => {
  const dictionary = useDictionary();
  if (counts === null) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="drive-summary-dialog">
      <DialogTitle>{dictionary.driveSummary.title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Stat testId="drive-folders-count" value={counts.foldersDone} label={dictionary.driveSummary.folders(counts.foldersDone)} />
        <Stat testId="drive-analyzed-count" value={counts.filesDone} label={dictionary.driveSummary.analyzed(counts.filesDone)} />
        <Stat testId="drive-skipped-count" value={counts.filesSkipped} label={dictionary.driveSummary.skipped(counts.filesSkipped)} />
        <Stat
          testId="drive-duplicate-skipped-count"
          value={counts.filesDuplicateSkipped}
          label={dictionary.driveSummary.duplicatesSkipped(counts.filesDuplicateSkipped)}
        />
        <Stat testId="drive-failed-count" value={counts.filesFailed} label={dictionary.driveSummary.failed(counts.filesFailed)} />
        {counts.estimatedCostUsd === null ? null : (
          <Stat
            testId="drive-estimated-cost"
            value={`$${counts.estimatedCostUsd.toFixed(4)}`}
            label={dictionary.driveSummary.estimatedCost(counts.costedFiles)}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button data-testid="drive-summary-close" variant="contained" onClick={onClose}>
          {dictionary.common.ok}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
