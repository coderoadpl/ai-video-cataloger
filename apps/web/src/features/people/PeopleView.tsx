import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';

import { MoreVertIcon } from '../../components/ui/icons.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import { mediaUrl } from '../../lib/media-url.js';
import { gradientIndexFor } from '../../lib/placeholder-gradient.js';
import { placeholderGradients } from '../../theme.js';
import { type FacePerson, type FacesReclusterReport, usePeople } from './use-people.js';

interface PeopleViewProps {
  active: boolean;
  folder: string | null;
  addLine: AddLogLine;
  onOpenSettings: () => void;
  onSearchInLibrary: (personId: string, label: string) => void;
  lockReason?: string | undefined;
  intervalMs?: number;
}

interface RenameState {
  person: FacePerson;
  value: string;
}

const displayName = (dictionary: Dictionary, person: FacePerson, index: number): string =>
  person.displayName ?? dictionary.people.personName(index);

export const PeopleView = ({
  active,
  folder,
  addLine,
  onOpenSettings,
  onSearchInLibrary,
  lockReason,
  intervalMs,
}: PeopleViewProps) => {
  const dictionary = useDictionary();
  const people = usePeople({ active, folder, addLine, ...(intervalMs === undefined ? {} : { intervalMs }) });
  const mutationsBlocked = lockReason !== undefined;
  const [rename, setRename] = useState<RenameState | null>(null);
  const [forgetTarget, setForgetTarget] = useState<FacePerson | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [reclusterOpen, setReclusterOpen] = useState(false);

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
          <Typography variant="h1">{dictionary.people.title}</Typography>
          <Typography variant="caption">{dictionary.people.subtitle}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            disabled={people.selectedPersonIds.length !== 2 || people.isBusy || mutationsBlocked}
            title={lockReason}
            onClick={() => setMergeOpen(true)}
            data-testid="people-merge-selected"
          >
            {dictionary.people.mergeSelected}
          </Button>
        </Box>
      </Box>

      {people.error === null ? null : <Alert severity="error">{formatAnalyzerError(people.error, dictionary.errors)}</Alert>}
      {people.activeJobLabel === null ? null : (
        <Alert severity="info" data-testid="people-active-job">{people.activeJobLabel}</Alert>
      )}
      {mutationsBlocked ? (
        <Alert severity="warning" data-testid="people-read-only">{lockReason}</Alert>
      ) : null}

      {people.isLoading ? (
        <LoadingState />
      ) : people.facesEnabled === false ? (
        <EmptyState
          title={dictionary.people.localFaceGroupingOffTitle}
          body={dictionary.people.localFaceGroupingOffBody}
          action={<Button variant="contained" onClick={onOpenSettings}>{dictionary.common.openSettings}</Button>}
          testId="people-disabled-state"
        />
      ) : people.artifactsReady === false ? (
        <EmptyState
          title={dictionary.people.modelsMissingTitle}
          body={dictionary.people.modelsMissingBody}
          action={
            <Button
              variant="contained"
              onClick={people.installArtifacts}
              disabled={people.isBusy}
              data-testid="people-install-models"
            >
              {dictionary.people.installModels}
            </Button>
          }
          testId="people-no-models-state"
        />
      ) : people.observations === 0 && people.people.length === 0 ? (
        <EmptyState
          title={dictionary.people.noFaceGroupingsTitle}
          body={dictionary.people.runIndexingInAnalysis}
          action={null}
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
                name={displayName(dictionary, person, index)}
                fallbackGlyph={person.displayName === null ? String(index + 1) : displayName(dictionary, person, index).charAt(0)}
                selected={people.selectedPersonIds.includes(person.personId)}
                disabled={people.isBusy}
                mutationsDisabled={mutationsBlocked}
                lockReason={lockReason}
                onToggle={() => people.toggleSelected(person.personId)}
                onRename={() => setRename({ person, value: displayName(dictionary, person, index) })}
                onForget={() => setForgetTarget(person)}
                onSearchInLibrary={() => onSearchInLibrary(person.personId, displayName(dictionary, person, index))}
              />
            ))}
          </Box>
          <Divider />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="people-danger-area">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{dictionary.people.dangerArea}</Typography>
            <Typography variant="caption">
              {dictionary.people.dangerBody}
            </Typography>
            <Box>
              <Button
                color="error"
                variant="outlined"
                size="small"
                disabled={people.isBusy || mutationsBlocked}
                title={lockReason}
                onClick={() => setReclusterOpen(true)}
                data-testid="people-recluster"
                sx={{ mr: 1 }}
              >
                {dictionary.people.recluster}
              </Button>
              <Button
                color="error"
                variant="outlined"
                size="small"
                disabled={people.isBusy || mutationsBlocked}
                title={lockReason}
                onClick={() => setPurgeOpen(true)}
                data-testid="people-purge"
              >
                {dictionary.people.deleteAllFaceData}
              </Button>
            </Box>
          </Box>
        </>
      )}

      <Dialog open={rename !== null} onClose={() => setRename(null)} fullWidth maxWidth="xs">
        <DialogTitle>{dictionary.people.renameGrouping}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            size="small"
            label={dictionary.people.displayName}
            value={rename?.value ?? ''}
            onChange={(event) => {
              const current = rename;
              if (current !== null) setRename({ ...current, value: event.target.value });
            }}
            slotProps={{ htmlInput: { 'data-testid': 'people-rename-input' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setRename(null)}>{dictionary.common.cancel}</Button>
          <Button
            variant="contained"
            disabled={rename === null || rename.value.trim().length === 0 || people.isBusy || mutationsBlocked}
            title={lockReason}
            onClick={() => {
              if (rename === null) return;
              people.rename(rename.person.personId, rename.value.trim());
              setRename(null);
            }}
            data-testid="people-rename-save"
          >
            {dictionary.common.save}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={mergeOpen && mergeTarget !== null}
        title={dictionary.people.mergeGroupings}
        body={mergeTarget === null
          ? ''
          : dictionary.people.mergeBody(
            displayName(dictionary, mergeTarget.from.person, mergeTarget.from.index),
            displayName(dictionary, mergeTarget.to.person, mergeTarget.to.index),
          )}
        confirmLabel={dictionary.people.merge}
        testId="people-merge-confirm"
        disabled={people.isBusy || mutationsBlocked}
        onClose={() => setMergeOpen(false)}
        onConfirm={() => {
          if (mergeTarget !== null) people.merge(mergeTarget.from.person.personId, mergeTarget.to.person.personId);
          setMergeOpen(false);
        }}
      />

      <ConfirmDialog
        open={forgetTarget !== null}
        title={dictionary.people.deleteFaceGrouping}
        body={dictionary.people.deleteFaceGroupingBody}
        confirmLabel={dictionary.people.delete}
        testId="people-forget-confirm"
        disabled={people.isBusy || mutationsBlocked}
        onClose={() => setForgetTarget(null)}
        onConfirm={() => {
          if (forgetTarget !== null) people.forget(forgetTarget.personId);
          setForgetTarget(null);
        }}
      />

      <Dialog
        open={reclusterOpen}
        onClose={() => {
          setReclusterOpen(false);
          people.clearReclusterReport();
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{dictionary.people.recluster}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <DialogContentText>{dictionary.people.reclusterDryRunBody}</DialogContentText>
          <DialogContentText>{dictionary.people.reclusterNamesBody}</DialogContentText>
          {people.reclusterDryRunReport === null ? null : (
            <ReclusterReport report={people.reclusterDryRunReport} dictionary={dictionary} />
          )}
        </DialogContent>
        <DialogActions>
          <Button
            color="inherit"
            onClick={() => {
              setReclusterOpen(false);
              people.clearReclusterReport();
            }}
          >
            {dictionary.common.cancel}
          </Button>
          <Button
            variant="outlined"
            color="error"
            onClick={people.startReclusterDryRun}
            disabled={people.isBusy || mutationsBlocked}
            data-testid="people-recluster-dry-run"
          >
            {dictionary.people.reclusterDryRun}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              people.confirmRecluster();
              setReclusterOpen(false);
            }}
            disabled={people.reclusterDryRunReport === null || people.isBusy || mutationsBlocked}
            data-testid="people-recluster-confirm"
          >
            {dictionary.people.reclusterConfirm}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={purgeOpen}
        title={dictionary.people.deleteAllFaceData}
        body={dictionary.people.deleteAllFaceDataBody}
        confirmLabel={dictionary.people.deleteAll}
        testId="people-purge-confirm"
        disabled={people.isBusy || mutationsBlocked}
        onClose={() => setPurgeOpen(false)}
        onConfirm={() => {
          people.purge();
          setPurgeOpen(false);
        }}
      />

      <Snackbar
        open={people.mutationError !== null}
        onClose={people.dismissMutationError}
        autoHideDuration={8000}
      >
        <Alert severity="error" onClose={people.dismissMutationError} data-testid="people-mutation-error">
          {people.mutationError}
        </Alert>
      </Snackbar>
    </Box>
  );
};

const ReclusterReport = ({ report, dictionary }: { report: FacesReclusterReport; dictionary: Dictionary }) => (
  <Box data-testid="people-recluster-report" sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
    <ReportMetric label={dictionary.people.reclusterPeopleBefore} value={report.personsBefore} />
    <ReportMetric label={dictionary.people.reclusterPeopleAfter} value={report.personsAfter} />
    <ReportMetric label={dictionary.people.reclusterReassigned} value={report.observationsReassigned} />
    <ReportMetric label={dictionary.people.reclusterUnassigned} value={report.observationsUnassigned} />
    <ReportMetric label={dictionary.people.reclusterWithoutExemplar} value={report.personsWithoutExemplar} />
    <ReportMetric label={dictionary.people.reclusterNamesDropped} value={report.namesDropped.length} />
    <Box sx={{ gridColumn: '1 / -1' }}>
      <Typography variant="caption" color="text.secondary">{dictionary.people.reclusterLargestClusters}</Typography>
      <Typography variant="body2" data-testid="people-recluster-largest">
        {report.largestClusters.length === 0
          ? dictionary.people.reclusterNoClusters
          : report.largestClusters.map((cluster) => `${cluster.personId}: ${String(cluster.observations)}`).join(', ')}
      </Typography>
    </Box>
  </Box>
);

const ReportMetric = ({ label, value }: { label: string; value: number }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2">{value}</Typography>
  </Box>
);

const LoadingState = () => {
  const dictionary = useDictionary();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
      <CircularProgress size={20} />
      <Typography variant="body2">{dictionary.people.loadingPeople}</Typography>
    </Box>
  );
};

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
  fallbackGlyph: string;
  selected: boolean;
  disabled: boolean;
  mutationsDisabled: boolean;
  lockReason: string | undefined;
  onToggle: () => void;
  onRename: () => void;
  onForget: () => void;
  onSearchInLibrary: () => void;
}

const PersonCard = ({
  person,
  name,
  fallbackGlyph,
  selected,
  disabled,
  mutationsDisabled,
  lockReason,
  onToggle,
  onRename,
  onForget,
  onSearchInLibrary,
}: PersonCardProps) => {
  const dictionary = useDictionary();
  const [imageFailed, setImageFailed] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const cropPath = imageFailed ? null : person.exemplarCropPath;

  return (
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
        slotProps={{ input: { 'aria-label': dictionary.people.selectPerson(name) } }}
        sx={{ position: 'absolute', top: 4, left: 4, bgcolor: 'background.paper', borderRadius: 1 }}
      />
      {cropPath === null ? (
        <Box
          data-testid="people-card-fallback"
          style={{ background: placeholderGradients.dark[gradientIndexFor(person.personId)] }}
          sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Typography variant="h4" sx={{ color: 'common.white' }}>{fallbackGlyph}</Typography>
        </Box>
      ) : (
        <Box
          component="img"
          alt={name}
          src={mediaUrl(cropPath, person.exemplarCount)}
          onError={() => setImageFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      <IconButton
        size="small"
        aria-label={dictionary.people.moreActions(name)}
        onClick={(event) => setMenuAnchor(event.currentTarget)}
        sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => { setMenuAnchor(null); onRename(); }}
          disabled={disabled || mutationsDisabled}
          title={lockReason}
          data-testid="people-rename"
        >
          {dictionary.people.rename}
        </MenuItem>
        <MenuItem
          onClick={() => { setMenuAnchor(null); onForget(); }}
          disabled={disabled || mutationsDisabled}
          title={lockReason}
          data-testid="people-forget"
          sx={{ color: 'error.main' }}
        >
          {dictionary.people.delete}
        </MenuItem>
        <MenuItem
          onClick={() => { setMenuAnchor(null); onSearchInLibrary(); }}
          data-testid="people-search-library"
        >
          {dictionary.people.searchInLibrary}
        </MenuItem>
      </Menu>
    </Box>
    <CardContent
      sx={{ p: 1.25, flex: 1, cursor: 'pointer' }}
      onClick={onSearchInLibrary}
      data-testid="people-card-body"
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={name}>{name}</Typography>
      <Typography variant="caption">{dictionary.people.observationCount(person.observationCount)}</Typography>
    </CardContent>
  </Card>
  );
};

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
}: ConfirmDialogProps) => {
  const dictionary = useDictionary();

  return (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>
      <DialogContentText>{body}</DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button color="inherit" onClick={onClose}>{dictionary.common.cancel}</Button>
      <Button color="error" variant="contained" onClick={onConfirm} disabled={disabled} data-testid={testId}>
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
  );
};
