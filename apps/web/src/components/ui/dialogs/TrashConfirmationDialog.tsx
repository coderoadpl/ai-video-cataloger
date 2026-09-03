import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';

import { useDictionary } from '../../../i18n/use-dictionary.js';

export interface TrashConfirmationRoot {
  folderId: string;
  displayName: string;
  currentPath: string;
  fileCount: number;
  writable: boolean;
  online: boolean;
}

export interface TrashConfirmationCounts {
  total: number;
  videoCount: number;
  photoCount: number;
  sharedWithOtherPeople?: number;
}

interface TrashConfirmationDialogProps {
  open: boolean;
  counts: TrashConfirmationCounts | null;
  roots: readonly TrashConfirmationRoot[];
  loading: boolean;
  error: string | null;
  checked: boolean;
  confirming: boolean;
  readOnlyRootNames?: readonly string[] | undefined;
  personSummary?: string | undefined;
  skipSharedControl?: ReactNode;
  onCheckedChange: (checked: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export const TrashConfirmationDialog = ({
  open,
  counts,
  roots,
  loading,
  error,
  checked,
  confirming,
  readOnlyRootNames = [],
  personSummary,
  skipSharedControl,
  onCheckedChange,
  onClose,
  onConfirm,
}: TrashConfirmationDialogProps) => {
  const dictionary = useDictionary();
  const readOnlyRootNamesFromPreview = roots.filter((root) => !root.writable).map((root) => root.displayName);
  const refusalRoots = [...readOnlyRootNamesFromPreview, ...readOnlyRootNames];
  const blocked = refusalRoots.length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="library-trash-dialog">
      <DialogTitle>{dictionary.library.trashDialogTitle}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {loading ? (
          <DialogContentText>{dictionary.library.trashDialogLoading}</DialogContentText>
        ) : error !== null ? (
          <Alert severity="error" data-testid="library-trash-preview-error">{error}</Alert>
        ) : counts === null ? (
          <Alert severity="error">{dictionary.library.trashDialogNoPreview}</Alert>
        ) : (
          <>
            <Typography variant="body2" data-testid="library-trash-count">
              {dictionary.library.trashDialogCount(counts.total, counts.videoCount, counts.photoCount)}
            </Typography>
            {personSummary === undefined ? null : (
              <Typography variant="body2" data-testid="library-trash-person-summary">
                {personSummary}
              </Typography>
            )}
            {skipSharedControl === undefined ? null : <Box>{skipSharedControl}</Box>}
            <DialogContentText>{dictionary.library.trashDialogErases}</DialogContentText>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{dictionary.library.trashDialogRoots}</Typography>
              <List dense disablePadding>
                {roots.map((root) => (
                  <ListItem key={`${root.folderId}:${root.currentPath}`} disableGutters data-testid="library-trash-root">
                    <ListItemText
                      primary={root.displayName}
                      secondary={`${root.currentPath} · ${dictionary.library.trashDialogRootCount(root.fileCount)}`}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
            {blocked ? (
              <Alert severity="warning" data-testid="library-trash-read-only">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{dictionary.library.trashDialogReadOnlyTitle}</Typography>
                <Typography variant="body2">{dictionary.library.trashDialogReadOnlyBody}</Typography>
                <Typography variant="body2">{refusalRoots.join(', ')}</Typography>
              </Alert>
            ) : (
              <FormControlLabel
                data-testid="library-trash-confirm-check"
                control={(
                  <Checkbox
                    checked={checked}
                    onChange={(event) => onCheckedChange(event.target.checked)}
                  />
                )}
                label={dictionary.library.trashDialogConfirmCheckbox}
              />
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>{dictionary.common.cancel}</Button>
        {blocked ? null : (
          <Button
            color="error"
            variant="contained"
            disabled={loading || counts === null || !checked || confirming}
            onClick={onConfirm}
            data-testid="library-trash-confirm"
          >
            {dictionary.library.trashDialogConfirm}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
