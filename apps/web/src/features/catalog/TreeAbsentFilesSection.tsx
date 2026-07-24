import { useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  Typography,
} from '@mui/material';

import { ChevronRightIcon, ExpandMoreIcon, WarningIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { folderName } from '../../lib/format.js';
import { type CatalogTreeNode } from './core/index.js';
import { type AbsentFileEntry } from './use-absent-files.js';
import { useTreeAbsentFiles } from './use-tree-absent-files.js';
import { useCatalogLock } from './use-catalog-lock.js';

const nameOf = (entry: AbsentFileEntry): string => entry.finalName ?? entry.fileName;
const lastSeenLabel = (missingAt: number): string => new Date(missingAt).toLocaleDateString();

export const TreeAbsentFilesSection = ({ root }: { root: CatalogTreeNode | null }) => {
  const dictionary = useDictionary();
  const [open, setOpen] = useState(false);
  const { groups, total, forget, isForgetting } = useTreeAbsentFiles(root?.path ?? null, open);
  const { disabledReason: lockReason } = useCatalogLock();
  const mutationsBlocked = lockReason !== undefined;
  const [pending, setPending] = useState<{ fingerprint: string; name: string } | null>(null);

  if (root === null) return null;

  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider' }} data-testid="tree-absent-files-section">
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="tree-absent-files-toggle"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          width: '100%',
          px: 2,
          py: 1,
          border: 0,
          background: 'none',
          cursor: 'pointer',
          color: 'inherit',
          textAlign: 'left',
        }}
      >
        {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        <WarningIcon fontSize="small" sx={(theme) => ({ color: theme.palette.status.notTracked.main })} />
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {open ? `${dictionary.catalog.absentSectionTitle} (${String(total)})` : dictionary.catalog.absentSectionTitle}
        </Typography>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1, pb: 1 }}>
          {total === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
              {dictionary.catalog.absentNone}
            </Typography>
          ) : null}
          {groups.map((group) => (
            <Box key={group.folder} sx={{ mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ px: 1, fontWeight: 600 }} title={group.folder}>
                {folderName(group.folder)}
              </Typography>
              <List dense disablePadding>
                {group.entries.map((entry) => (
                  <ListItem
                    key={entry.fingerprint}
                    data-testid="tree-absent-file-item"
                    sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', py: 0.5 }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap title={nameOf(entry)}>
                        {nameOf(entry)}
                      </Typography>
                      {entry.missingAt === null ? null : (
                        <Typography variant="caption" color="text.secondary">
                          {dictionary.catalog.absentLastSeen(lastSeenLabel(entry.missingAt))}
                        </Typography>
                      )}
                    </Box>
                    <Button
                      size="small"
                      color="error"
                      data-testid="tree-absent-file-forget"
                      disabled={mutationsBlocked}
                      title={lockReason}
                      onClick={() => setPending({ fingerprint: entry.fingerprint, name: nameOf(entry) })}
                    >
                      {dictionary.catalog.forgetEntry}
                    </Button>
                  </ListItem>
                ))}
              </List>
            </Box>
          ))}
        </Box>
      </Collapse>
      <Dialog open={pending !== null} onClose={() => setPending(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{dictionary.catalog.forgetEntryConfirmTitle}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pending === null ? '' : dictionary.catalog.forgetEntryConfirmBody(pending.name)}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setPending(null)}>
            {dictionary.common.cancel}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={isForgetting || mutationsBlocked}
            title={lockReason}
            data-testid="tree-absent-file-forget-confirm"
            onClick={() => {
              if (pending !== null) forget(pending.fingerprint);
              setPending(null);
            }}
          >
            {dictionary.catalog.forgetEntryConfirm}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
