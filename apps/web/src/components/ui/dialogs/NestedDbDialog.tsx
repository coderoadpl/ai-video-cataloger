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

interface NestedDbDialogProps {
  open: boolean;
  paths: readonly string[];
  onClose: () => void;
}

/**
 * Blocks opening a folder that contains nested `.ai-video-cataloger` databases
 * (parity-inventory §10 folder safety): nested catalogs cause conflicting
 * tracking, so the folder is not accepted and the offending paths are listed for
 * the user to remove or merge.
 */
export const NestedDbDialog = ({ open, paths, onClose }: NestedDbDialogProps) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="nested-db-dialog">
    <DialogTitle sx={{ color: 'error.main' }}>Nested Databases Detected</DialogTitle>
    <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <DialogContentText>
        The selected folder contains nested <code>.ai-video-cataloger</code> folders. This can cause
        data conflicts and unexpected behavior. Please remove or merge these nested databases before
        continuing:
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
        OK
      </Button>
    </DialogActions>
  </Dialog>
);
