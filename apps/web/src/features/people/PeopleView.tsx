import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  TextField,
  Typography,
} from '@mui/material';

import { ImageIcon } from '../../components/ui/icons.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { mediaUrl } from '../../lib/media-url.js';
import { type FacePerson, usePeople } from './use-people.js';

interface PeopleViewProps {
  active: boolean;
  folder: string | null;
  addLine: AddLogLine;
  onOpenSettings: () => void;
  intervalMs?: number;
}

interface RenameState {
  person: FacePerson;
  value: string;
}

const displayName = (person: FacePerson, index: number): string =>
  person.displayName ?? `Person ${String(index + 1)}`;

export const PeopleView = ({
  active,
  folder,
  addLine,
  onOpenSettings,
  intervalMs,
}: PeopleViewProps) => {
  const people = usePeople({ active, folder, addLine, ...(intervalMs === undefined ? {} : { intervalMs }) });
  const [rename, setRename] = useState<RenameState | null>(null);
  const [forgetTarget, setForgetTarget] = useState<FacePerson | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);

  const indexed = useMemo(
    () => new Map(people.people.map((person, index) => [person.personId, { person, index }])),
    [people.people],
  );
  const selected = people.selectedPersonIds
    .map((personId) => indexed.get(personId))
    .filter((entry): entry is { person: FacePerson; index: number } => entry !== undefined);
  const mergeTarget = selected.length === 2 && selected[0] !== undefined && selected[1] !== undefined
    ? { to: selected[0], from: selected[1] }
    : null;

  if (!active) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%', p: 3, gap: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography variant="h1">People</Typography>
          <Typography variant="caption">Local face grouping across indexed catalog videos.</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            disabled={people.selectedPersonIds.length !== 2 || people.isBusy}
            onClick={() => setMergeOpen(true)}
            data-testid="people-merge-selected"
          >
            Merge selected
          </Button>
          <Button
            variant="contained"
            size="small"
            disabled={folder === null || people.isBusy || people.facesEnabled !== true || people.artifactsReady !== true}
            onClick={people.indexFaces}
            data-testid="people-index"
          >
            Index faces
          </Button>
        </Box>
      </Box>

      {people.error === null ? null : <Alert severity="error">{people.error}</Alert>}
      {people.activeJobLabel === null ? null : (
        <Alert severity="info" data-testid="people-active-job">{people.activeJobLabel}</Alert>
      )}

      {people.isLoading ? (
        <LoadingState />
      ) : people.facesEnabled === false ? (
        <EmptyState
          title="Local face grouping is off"
          body="Turn on local face grouping in Settings to group faces on this Mac."
          action={<Button variant="contained" onClick={onOpenSettings}>Open Settings</Button>}
          testId="people-disabled-state"
        />
      ) : people.artifactsReady === false ? (
        <EmptyState
          title="Face grouping models are not installed"
          body="Install the local model files before indexing face groupings."
          action={
            <Button
              variant="contained"
              onClick={people.installArtifacts}
              disabled={people.isBusy}
              data-testid="people-install-models"
            >
              Install models
            </Button>
          }
          testId="people-no-models-state"
        />
      ) : people.observations === 0 && people.people.length === 0 ? (
        <EmptyState
          title="No face groupings yet"
          body={folder === null
            ? 'Select a folder, then run ai-video-cataloger faces index <folder>.'
            : 'Run indexing to create local face groupings for this folder.'}
          action={folder === null ? null : (
            <Button variant="contained" onClick={people.indexFaces} disabled={people.isBusy}>
              Index faces
            </Button>
          )}
          testId="people-empty-state"
        />
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 1.5,
            }}
            data-testid="people-grid"
          >
            {people.people.map((person, index) => (
              <PersonCard
                key={person.personId}
                person={person}
                name={displayName(person, index)}
                selected={people.selectedPersonIds.includes(person.personId)}
                disabled={people.isBusy}
                onToggle={() => people.toggleSelected(person.personId)}
                onRename={() => setRename({ person, value: displayName(person, index) })}
                onForget={() => setForgetTarget(person)}
              />
            ))}
          </Box>
          <Divider />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="people-danger-area">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Danger area</Typography>
            <Typography variant="caption">
              Delete all local face data if you want to remove every grouping and exemplar crop.
            </Typography>
            <Box>
              <Button
                color="error"
                variant="outlined"
                size="small"
                disabled={people.isBusy}
                onClick={() => setPurgeOpen(true)}
                data-testid="people-purge"
              >
                Delete all face data
              </Button>
            </Box>
          </Box>
        </>
      )}

      <Dialog open={rename !== null} onClose={() => setRename(null)} fullWidth maxWidth="xs">
        <DialogTitle>Rename grouping</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            size="small"
            label="Display name"
            value={rename?.value ?? ''}
            onChange={(event) => {
              const current = rename;
              if (current !== null) setRename({ ...current, value: event.target.value });
            }}
            slotProps={{ htmlInput: { 'data-testid': 'people-rename-input' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setRename(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={rename === null || rename.value.trim().length === 0 || people.isBusy}
            onClick={() => {
              if (rename === null) return;
              people.rename(rename.person.personId, rename.value.trim());
              setRename(null);
            }}
            data-testid="people-rename-save"
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={mergeOpen && mergeTarget !== null}
        title="Merge groupings"
        body={mergeTarget === null ? '' : `Merge ${displayName(mergeTarget.from.person, mergeTarget.from.index)} into ${displayName(mergeTarget.to.person, mergeTarget.to.index)}? This cannot be undone.`}
        confirmLabel="Merge"
        testId="people-merge-confirm"
        disabled={people.isBusy}
        onClose={() => setMergeOpen(false)}
        onConfirm={() => {
          if (mergeTarget !== null) people.merge(mergeTarget.from.person.personId, mergeTarget.to.person.personId);
          setMergeOpen(false);
        }}
      />

      <ConfirmDialog
        open={forgetTarget !== null}
        title="Delete face grouping"
        body="This removes this person's grouping, assignments, and exemplar crops. It cannot be undone."
        confirmLabel="Delete"
        testId="people-forget-confirm"
        disabled={people.isBusy}
        onClose={() => setForgetTarget(null)}
        onConfirm={() => {
          if (forgetTarget !== null) people.forget(forgetTarget.personId);
          setForgetTarget(null);
        }}
      />

      <ConfirmDialog
        open={purgeOpen}
        title="Delete all face data"
        body="This permanently deletes all local face grouping data and exemplar crops. It cannot be undone."
        confirmLabel="Delete all"
        testId="people-purge-confirm"
        disabled={people.isBusy}
        onClose={() => setPurgeOpen(false)}
        onConfirm={() => {
          people.purge();
          setPurgeOpen(false);
        }}
      />
    </Box>
  );
};

const LoadingState = () => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
    <CircularProgress size={20} />
    <Typography variant="body2">Loading people...</Typography>
  </Box>
);

interface EmptyStateProps {
  title: string;
  body: string;
  action: ReactNode;
  testId: string;
}

const EmptyState = ({ title, body, action, testId }: EmptyStateProps) => (
  <Box
    sx={{
      flex: 1,
      minHeight: 260,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      gap: 1,
      color: 'text.secondary',
    }}
    data-testid={testId}
  >
    <Typography variant="h2" color="text.primary">{title}</Typography>
    <Typography variant="body2" sx={{ maxWidth: 420 }}>{body}</Typography>
    {action === null ? null : <Box sx={{ mt: 1 }}>{action}</Box>}
  </Box>
);

interface PersonCardProps {
  person: FacePerson;
  name: string;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onRename: () => void;
  onForget: () => void;
}

const PersonCard = ({
  person,
  name,
  selected,
  disabled,
  onToggle,
  onRename,
  onForget,
}: PersonCardProps) => (
  <Card
    variant="outlined"
    data-testid="people-card"
    data-person-id={person.personId}
    sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
  >
    <Box
      sx={{
        height: 140,
        bgcolor: 'background.default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <Checkbox
        checked={selected}
        disabled={disabled}
        onChange={onToggle}
        slotProps={{ input: { 'aria-label': `Select ${name}` } }}
        sx={{ position: 'absolute', top: 4, left: 4, bgcolor: 'background.paper', borderRadius: 1 }}
      />
      {person.exemplarCropPath === null ? (
        <ImageIcon sx={{ color: 'text.secondary' }} />
      ) : (
        <Box
          component="img"
          alt={name}
          src={mediaUrl(person.exemplarCropPath, person.exemplarCount)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </Box>
    <CardContent sx={{ p: 1.25, flex: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={name}>{name}</Typography>
      <Typography variant="caption">{person.observationCount} observation(s)</Typography>
    </CardContent>
    <CardActions sx={{ px: 1, py: 0.75 }}>
      <Button size="small" onClick={onRename} disabled={disabled} data-testid="people-rename">
        Rename
      </Button>
      <Button size="small" color="error" onClick={onForget} disabled={disabled} data-testid="people-forget">
        Delete
      </Button>
    </CardActions>
  </Card>
);

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  testId: string;
  disabled: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const ConfirmDialog = ({
  open,
  title,
  body,
  confirmLabel,
  testId,
  disabled,
  onClose,
  onConfirm,
}: ConfirmDialogProps) => (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>
      <DialogContentText>{body}</DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button color="inherit" onClick={onClose}>Cancel</Button>
      <Button color="error" variant="contained" onClick={onConfirm} disabled={disabled} data-testid={testId}>
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);
