import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  Typography,
} from '@mui/material';

import { useDictionary } from '../../../i18n/use-dictionary.js';

export interface BatchResultItem {
  filename: string;
  success: boolean;
  error?: string;
}

interface BatchSummaryDialogProps {
  open: boolean;
  results: readonly BatchResultItem[];
  onClose: () => void;
}

export const BatchSummaryDialog = ({ open, results, onClose }: BatchSummaryDialogProps) => {
  const dictionary = useDictionary();
  const failed = results.filter((result) => !result.success);
  const successCount = results.length - failed.length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="batch-summary-dialog">
      <DialogTitle>{dictionary.batchSummary.title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 3 }}>
          <Typography variant="body2">
            <Box component="span" data-testid="batch-success-count" sx={{ fontWeight: 600 }}>
              {successCount}
            </Box>{' '}
            {dictionary.batchSummary.successful}
          </Typography>
          <Typography variant="body2">
            <Box component="span" data-testid="batch-failed-count" sx={{ fontWeight: 600 }}>
              {failed.length}
            </Box>{' '}
            {dictionary.batchSummary.failed}
          </Typography>
        </Box>
        {failed.length > 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {dictionary.batchSummary.failedVideos}
            </Typography>
            <List
              dense
              disablePadding
              sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1, maxHeight: 200, overflow: 'auto' }}
            >
              {failed.map((result) => (
                <ListItem key={result.filename} disableGutters sx={{ display: 'block', py: 0.25 }}>
                  <Typography variant="body2" noWrap title={result.filename} sx={{ fontWeight: 500 }}>
                    {result.filename}
                  </Typography>
                  <Typography variant="caption">{result.error ?? dictionary.batchSummary.unknownError}</Typography>
                </ListItem>
              ))}
            </List>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button data-testid="batch-summary-close" variant="contained" onClick={onClose}>
          {dictionary.common.ok}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
