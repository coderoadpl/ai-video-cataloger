import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  Typography,
} from '@mui/material';

import { useDictionary } from '../../../i18n/use-dictionary.js';

interface NestedDbDialogProps {
  open: boolean;
  paths: readonly string[];
  onClose: () => void;
}

export const NestedDbDialog = ({ open, paths, onClose }: NestedDbDialogProps) => {
  const dictionary = useDictionary();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="nested-db-dialog">
      <DialogTitle sx={{ color: 'error.main' }}>{dictionary.nestedDbDialog.title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <DialogContentText>
          {dictionary.nestedDbDialog.bodyBefore}
          <code>.ai-video-cataloger</code>
          {dictionary.nestedDbDialog.bodyAfter}
        </DialogContentText>
        <Box>
          <List
            dense
            disablePadding
            sx={{
              bgcolor: 'action.hover',
              borderRadius: 1,
              p: 1,
              maxHeight: 200,
              overflow: 'auto',
              fontFamily: 'monospace',
            }}
          >
            {paths.map((path) => (
              <ListItem key={path} disableGutters sx={{ py: 0.25 }}>
                <Typography variant="caption" noWrap title={path} sx={{ fontFamily: 'monospace' }}>
                  {path}
                </Typography>
              </ListItem>
            ))}
          </List>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {dictionary.common.ok}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
