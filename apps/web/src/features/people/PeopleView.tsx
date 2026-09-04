import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Snackbar,
  Slider,
  TextField,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';

import { ApiError, invalidateLibraryVisibilityConsumers, isTerminalJobStatus } from '@core/client/index.js';
import { libraryTrashSummaryOfDetails } from '@core/contract/index.js';

import { actions } from '../../api.js';
import { MoreVertIcon } from '../../components/ui/icons.js';
import { MediaFilterToggle } from '../../components/ui/MediaFilterToggle.js';
import { TrashConfirmationDialog, type TrashConfirmationCounts, type TrashConfirmationRoot } from '../../components/ui/dialogs/TrashConfirmationDialog.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import { mediaUrl } from '../../lib/media-url.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { readStorageItem, writeStorageItem } from '../../lib/persistent-storage.js';
import { gradientIndexFor } from '../../lib/placeholder-gradient.js';
import { placeholderGradients } from '../../theme.js';
import {
  peopleForMedium,
  peopleMediaCounts,
  personCountForMedium,
  personFileCountLabel,
  sortPeople,
  type PeopleMedia,
  type PeopleSort,
} from './core/index.js';
import { type FacePerson, type FacesReclusterReport, usePeople } from './use-people.js';

export interface PersonMediaRequest {
  personId: string;
  label: string;
  media: PeopleMedia;
  fileCountLabel?: string;
  observationCountLabel?: string;
  onClose: () => void;
}

export interface PeopleViewProps {
  active: boolean;
  folder: string | null;
  addLine: AddLogLine;
  onOpenSettings: () => void;
  onSearchInLibrary: (personId: string, label: string) => void;
  renderPersonMedia?: ((request: PersonMediaRequest) => ReactNode) | undefined;
  lockReason?: string | undefined;
  intervalMs?: number;
}

interface RenameState {
  person: FacePerson;
  value: string;
}

interface PersonLibraryAction {
  kind: 'hide' | 'trash';
  personId: string;
  name: string;
  skipSharedWithOtherPeople: boolean;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

const displayName = (dictionary: Dictionary, person: FacePerson): string =>
  person.displayName ?? dictionary.people.personName(person.fallbackIndex);

const PEOPLE_SORT_KEY = 'avc.people.sort';
const PEOPLE_MIN_OBSERVATIONS_KEY = 'avc.people.minObservations';
const PEOPLE_MIN_OBSERVATION_OPTIONS = [1, 2, 3, 5, 10, 20, 50] as const;
type PeopleMinObservations = (typeof PEOPLE_MIN_OBSERVATION_OPTIONS)[number];

const isPeopleSort = (value: string | null): value is PeopleSort => value === 'frequent' || value === 'order';
const isPeopleMinObservations = (value: number): value is PeopleMinObservations =>
  PEOPLE_MIN_OBSERVATION_OPTIONS.some((option) => option === value);

const readPeopleSort = (): PeopleSort => {
  const raw = readStorageItem('local', PEOPLE_SORT_KEY);
  return isPeopleSort(raw) ? raw : 'frequent';
};

const readPeopleMinObservations = (): PeopleMinObservations => {
  const parsed = Number(readStorageItem('local', PEOPLE_MIN_OBSERVATIONS_KEY));
  return Number.isInteger(parsed) && isPeopleMinObservations(parsed) ? parsed : 10;
};

const peopleMinObservationSliderMarks = PEOPLE_MIN_OBSERVATION_OPTIONS.map((value, index) => ({ value: index, label: String(value) }));

const peopleMinObservationIndex = (value: PeopleMinObservations): number => PEOPLE_MIN_OBSERVATION_OPTIONS.indexOf(value);

const peopleMinObservationAtIndex = (index: number): PeopleMinObservations | null =>
  PEOPLE_MIN_OBSERVATION_OPTIONS[index] ?? null;

const peopleObservationTotal = (people: readonly FacePerson[]): number =>
  people.reduce((total, person) => total + person.observationCount, 0);

export const PeopleView = ({
  active,
  folder,
  addLine,
  onOpenSettings,
  onSearchInLibrary,
  renderPersonMedia,
  lockReason,
  intervalMs,
}: PeopleViewProps) => {
  const dictionary = useDictionary();
  const queryClient = useQueryClient();
  const people = usePeople({ active, folder, addLine, ...(intervalMs === undefined ? {} : { intervalMs }) });
  const mutationsBlocked = lockReason !== undefined;
  const [rename, setRename] = useState<RenameState | null>(null);
  const [forgetTarget, setForgetTarget] = useState<FacePerson | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [reclusterOpen, setReclusterOpen] = useState(false);
  const [media, setMedia] = useState<PeopleMedia>('all');
  const [sort, setSortState] = useState<PeopleSort>(() => readPeopleSort());
  const [minObservations, setMinObservationsState] = useState<PeopleMinObservations>(() => readPeopleMinObservations());
  const [foldedOpen, setFoldedOpen] = useState(false);
  const [openPerson, setOpenPerson] = useState<{ personId: string; label: string } | null>(null);
  const [libraryAction, setLibraryAction] = useState<PersonLibraryAction | null>(null);
  const [trashChecked, setTrashChecked] = useState(false);
  const [libraryActionError, setLibraryActionError] = useState<string | null>(null);
  const hideMutation = useMutation(actions.libraryHide);
  const trashMutation = useMutation(actions.libraryTrash);
  const setSort = (next: PeopleSort) => {
    setSortState(next);
    writeStorageItem('local', PEOPLE_SORT_KEY, next);
  };
  const setMinObservations = (next: PeopleMinObservations) => {
    setMinObservationsState(next);
    setFoldedOpen(false);
    writeStorageItem('local', PEOPLE_MIN_OBSERVATIONS_KEY, String(next));
  };

  const peopleById = useMemo(
    () => new Map(people.people.map((person) => [person.personId, person])),
    [people.people],
  );
  const mediaCounts = useMemo(() => peopleMediaCounts(people.people), [people.people]);
  const visiblePeople = useMemo(() => sortPeople(peopleForMedium(people.people, media), sort, media), [people.people, media, sort]);
  const foldedPeople = useMemo(
    () => visiblePeople.filter((person) => person.displayName === null && person.observationCount < minObservations),
    [minObservations, visiblePeople],
  );
  const primaryPeople = useMemo(
    () => visiblePeople.filter((person) => person.displayName !== null || person.observationCount >= minObservations),
    [minObservations, visiblePeople],
  );
  const gridPeople = foldedOpen ? foldedPeople : primaryPeople;
  const foldedObservationCount = peopleObservationTotal(foldedPeople);
  const openPersonEntry = openPerson === null ? null : peopleById.get(openPerson.personId) ?? null;
  const reclusterConfirmLabel = people.reclusterDryRunReport !== null && people.reclusterDryRunReport.namesDropped.length > 0
    ? dictionary.people.reclusterConfirmWithNames(people.reclusterDryRunReport.namesDropped.length)
    : dictionary.people.reclusterConfirm;
  const selected = people.selectedPersonIds
    .map((personId) => peopleById.get(personId))
    .filter((person): person is FacePerson => person !== undefined);
  const mergeTarget = selected.length === 2 && selected[0] !== undefined && selected[1] !== undefined
    ? { to: selected[0], from: selected[1] }
    : null;
  const libraryActionScope = libraryAction === null
    ? { kind: 'person' as const, personId: 'preview-placeholder', skipSharedWithOtherPeople: false }
    : {
      kind: 'person' as const,
      personId: libraryAction.personId,
      skipSharedWithOtherPeople: libraryAction.skipSharedWithOtherPeople,
    };
  const libraryActionPreviewScope = libraryAction === null
    ? libraryActionScope
    : { kind: 'person' as const, personId: libraryAction.personId, skipSharedWithOtherPeople: false };
  const libraryActionPreview = useQuery({
    ...actions.librarySelectionPreview({ scope: libraryActionPreviewScope }),
    enabled: active && libraryAction !== null,
  });
  const libraryActionCounts: TrashConfirmationCounts | null = libraryActionPreview.data === undefined ? null : {
    total: libraryActionPreview.data.total,
    videoCount: libraryActionPreview.data.videoCount,
    photoCount: libraryActionPreview.data.photoCount,
    hiddenCount: libraryActionPreview.data.hiddenCount,
    sharedWithOtherPeople: libraryActionPreview.data.sharedWithOtherPeople,
  };
  const libraryActionRoots: TrashConfirmationRoot[] = libraryActionPreview.data?.roots ?? [];
  const personSummary = libraryAction === null || libraryActionPreview.data === undefined
    ? ''
    : dictionary.people.personSelectionSummary(
      libraryActionPreview.data.total,
      libraryActionPreview.data.sharedWithOtherPeople,
    );
  const closeLibraryAction = (): void => {
    setLibraryAction(null);
    setTrashChecked(false);
    setLibraryActionError(null);
  };
  const skipSharedControl = libraryAction === null ? null : (
    <FormControlLabel
      data-testid="people-library-skip-shared"
      control={(
        <Checkbox
          checked={libraryAction.skipSharedWithOtherPeople}
          onChange={(event) => setLibraryAction({
            ...libraryAction,
            skipSharedWithOtherPeople: event.target.checked,
          })}
        />
      )}
      label={dictionary.people.skipSharedWithOtherPeople}
    />
  );
  const runPersonHide = (): void => {
    if (libraryAction === null) return;
    void (async () => {
      try {
        await hideMutation.mutateAsync({ scope: libraryActionScope });
        addLine(dictionary.people.hiddenPersonFilesLog(libraryAction.name), 'success');
        await invalidateLibraryVisibilityConsumers(queryClient);
        closeLibraryAction();
      } catch (error) {
        setLibraryActionError(`${dictionary.people.hidePersonFilesFailedLog}: ${messageOf(error)}`);
      }
    })();
  };
  const runPersonTrash = (): void => {
    if (libraryAction === null) return;
    void (async () => {
      try {
        const output = await trashMutation.mutateAsync({ scope: libraryActionScope, confirm: true, dryRun: false });
        if (output.kind === 'job') {
          const final = await pollJobUntilTerminal(output.jobId, {
            intervalMs: intervalMs ?? 1000,
            delay: sleep,
            fetchJob: (jobId) => queryClient.fetchQuery(actions.job({ jobId })),
            isTerminal: (snapshot) => isTerminalJobStatus(snapshot.status),
            onSnapshot: () => undefined,
          });
          if (final.status !== 'completed') {
            throw new ApiError(final.error ?? { code: 'internal', message: dictionary.people.trashPersonFilesFailedLog });
          }
        }
        addLine(dictionary.people.trashPersonFilesLog(libraryAction.name), 'success');
        closeLibraryAction();
      } catch (error) {
        const summary = error instanceof ApiError ? libraryTrashSummaryOfDetails(error.appError.details) : null;
        setLibraryActionError(summary === null
          ? `${dictionary.people.trashPersonFilesFailedLog}: ${messageOf(error)}`
          : `${dictionary.people.trashPersonFilesFailedLog}: ${dictionary.library.trashIncompleteCounts(summary.filesTrashed, summary.filesFailed, summary.filesNotAttempted)}`);
      } finally {
        await invalidateLibraryVisibilityConsumers(queryClient);
      }
    })();
  };

  if (!active) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%', p: 3, gap: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h1">{dictionary.people.title}</Typography>
          <Typography variant="caption" data-testid={foldedOpen ? 'people-scope' : undefined}>
            {foldedOpen ? dictionary.people.otherPeopleScope : dictionary.people.subtitle}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <ThresholdControl value={minObservations} onChange={setMinObservations} />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={sort}
            onChange={(_event, next: PeopleSort | null) => { if (next !== null) setSort(next); }}
            data-testid="people-sort"
          >
            <ToggleButton value="frequent" data-testid="people-sort-frequency">
              {dictionary.people.sortFrequent}
            </ToggleButton>
            <ToggleButton value="order" data-testid="people-sort-order">
              {dictionary.people.sortOrder}
            </ToggleButton>
          </ToggleButtonGroup>
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
          {foldedOpen ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => setFoldedOpen(false)}
                data-testid="people-back-main"
              >
                {dictionary.people.backToMainPeople}
              </Button>
            </Box>
          ) : null}
          <MediaFilterToggle
            value={media}
            counts={mediaCounts}
            onChange={(next) => {
              setMedia(next);
              setFoldedOpen(false);
            }}
            groupTestId="people-media-filter"
            optionTestIdPrefix="people-media"
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 1.5,
            }}
            data-testid="people-grid"
          >
            {gridPeople.map((person) => {
              const name = displayName(dictionary, person);
              return (
                <PersonCard
                  key={person.personId}
                  person={person}
                  name={name}
                  media={media}
                  fallbackGlyph={person.displayName === null ? String(person.fallbackIndex + 1) : name.charAt(0)}
                  selected={people.selectedPersonIds.includes(person.personId)}
                  disabled={people.isBusy}
                  mutationsDisabled={mutationsBlocked}
                  lockReason={lockReason}
                  onToggle={() => people.toggleSelected(person.personId)}
                  onRename={() => setRename({ person, value: name })}
                  onForget={() => setForgetTarget(person)}
                  onOpen={() => setOpenPerson({ personId: person.personId, label: name })}
                  onSearchInLibrary={() => onSearchInLibrary(person.personId, name)}
                  onHidePersonFiles={() => setLibraryAction({
                    kind: 'hide',
                    personId: person.personId,
                    name,
                    skipSharedWithOtherPeople: false,
                  })}
                  onTrashPersonFiles={() => {
                    setTrashChecked(false);
                    setLibraryAction({
                      kind: 'trash',
                      personId: person.personId,
                      name,
                      skipSharedWithOtherPeople: true,
                    });
                  }}
                />
              );
            })}
            {foldedOpen || foldedPeople.length === 0 ? null : (
              <OtherPeopleTile
                peopleCount={foldedPeople.length}
                observationCount={foldedObservationCount}
                onClick={() => setFoldedOpen(true)}
              />
            )}
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
            displayName(dictionary, mergeTarget.from),
            displayName(dictionary, mergeTarget.to),
          )}
        confirmLabel={dictionary.people.merge}
        testId="people-merge-confirm"
        disabled={people.isBusy || mutationsBlocked}
        onClose={() => setMergeOpen(false)}
        onConfirm={() => {
          if (mergeTarget !== null) people.merge(mergeTarget.from.personId, mergeTarget.to.personId);
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
            {reclusterConfirmLabel}
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

      <Dialog open={libraryAction?.kind === 'hide'} onClose={closeLibraryAction} fullWidth maxWidth="sm">
        <DialogTitle>
          {libraryAction === null ? dictionary.people.hidePersonFiles : dictionary.people.personSelectionTitle(libraryAction.name)}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {libraryActionPreview.isLoading || libraryActionPreview.isFetching ? (
            <DialogContentText>{dictionary.library.trashDialogLoading}</DialogContentText>
          ) : libraryActionPreview.isError ? (
            <Alert severity="error" data-testid="people-library-action-error">{messageOf(libraryActionPreview.error)}</Alert>
          ) : (
            <DialogContentText data-testid="people-library-action-summary">{personSummary}</DialogContentText>
          )}
          {skipSharedControl}
          {libraryActionError === null ? null : (
            <Alert severity="error" data-testid="people-library-action-error">{libraryActionError}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={closeLibraryAction}>{dictionary.common.cancel}</Button>
          <Button
            variant="contained"
            disabled={libraryActionCounts === null || hideMutation.isPending}
            onClick={runPersonHide}
            data-testid="people-hide-files-confirm"
          >
            {dictionary.people.hidePersonConfirm}
          </Button>
        </DialogActions>
      </Dialog>

      <TrashConfirmationDialog
        open={libraryAction?.kind === 'trash'}
        counts={libraryActionCounts}
        roots={libraryActionRoots}
        loading={libraryActionPreview.isLoading || libraryActionPreview.isFetching}
        error={libraryActionPreview.isError || libraryActionError !== null
          ? libraryActionError ?? messageOf(libraryActionPreview.error)
          : null}
        checked={trashChecked}
        confirming={trashMutation.isPending}
        personSummary={personSummary}
        skipSharedControl={skipSharedControl}
        onCheckedChange={setTrashChecked}
        onClose={closeLibraryAction}
        onConfirm={runPersonTrash}
      />

      {openPerson === null || renderPersonMedia === undefined
        ? null
        : renderPersonMedia({
          ...openPerson,
          media,
          ...(openPersonEntry === null ? {} : {
            fileCountLabel: personFileCountLabel(dictionary.people, openPersonEntry, media),
            observationCountLabel: dictionary.people.frameObservationCount(personCountForMedium(openPersonEntry, media)),
          }),
          onClose: () => setOpenPerson(null),
        })}

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

const ThresholdControl = ({
  value,
  onChange,
}: {
  value: PeopleMinObservations;
  onChange: (value: PeopleMinObservations) => void;
}) => {
  const dictionary = useDictionary();

  return (
    <Box
      data-testid="people-threshold-control"
      sx={{
        width: { xs: '100%', sm: 220 },
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
      }}
    >
      <Typography variant="caption">
        {dictionary.people.minObservationThreshold(value)}
      </Typography>
      <Slider
        size="small"
        min={0}
        max={PEOPLE_MIN_OBSERVATION_OPTIONS.length - 1}
        step={1}
        marks={peopleMinObservationSliderMarks}
        value={peopleMinObservationIndex(value)}
        valueLabelDisplay="auto"
        valueLabelFormat={(current) => {
          const threshold = peopleMinObservationAtIndex(current);
          return threshold === null ? '' : String(threshold);
        }}
        getAriaValueText={(current) => {
          const threshold = peopleMinObservationAtIndex(current);
          return threshold === null ? '' : dictionary.people.minObservationThreshold(threshold);
        }}
        aria-label={dictionary.people.minObservationThresholdAria}
        onChange={(_event, next) => {
          if (typeof next !== 'number' || !Number.isInteger(next)) return;
          const threshold = peopleMinObservationAtIndex(next);
          if (threshold !== null) onChange(threshold);
        }}
        data-testid="people-threshold-slider"
      />
    </Box>
  );
};

const OtherPeopleTile = ({
  peopleCount,
  observationCount,
  onClick,
}: {
  peopleCount: number;
  observationCount: number;
  onClick: () => void;
}) => {
  const dictionary = useDictionary();

  return (
    <Box
      component="button"
      type="button"
      data-testid="people-other-tile"
      onClick={onClick}
      sx={(theme) => ({
        minHeight: 210,
        border: `1px dashed ${theme.palette.people.otherTileBorder}`,
        borderRadius: `${String(theme.shape.borderRadius)}px`,
        bgcolor: theme.palette.people.otherTileBackground,
        color: theme.palette.people.otherTileText,
        cursor: 'pointer',
        p: 1.5,
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 0.75,
        font: 'inherit',
        '&:hover': {
          bgcolor: theme.palette.people.otherTileHoverBackground,
        },
      })}
    >
      <Typography variant="h2" color="inherit">
        {dictionary.people.otherPeopleTile(peopleCount, observationCount)}
      </Typography>
      <Typography variant="caption" sx={(theme) => ({ color: theme.palette.people.otherTileText })}>
        {dictionary.people.otherPeopleOpen}
      </Typography>
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
  media: PeopleMedia;
  fallbackGlyph: string;
  selected: boolean;
  disabled: boolean;
  mutationsDisabled: boolean;
  lockReason: string | undefined;
  onToggle: () => void;
  onRename: () => void;
  onForget: () => void;
  onOpen: () => void;
  onSearchInLibrary: () => void;
  onHidePersonFiles: () => void;
  onTrashPersonFiles: () => void;
}

const PersonCard = ({
  person,
  name,
  media,
  fallbackGlyph,
  selected,
  disabled,
  mutationsDisabled,
  lockReason,
  onToggle,
  onRename,
  onForget,
  onOpen,
  onSearchInLibrary,
  onHidePersonFiles,
  onTrashPersonFiles,
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
        <MenuItem
          onClick={() => { setMenuAnchor(null); onHidePersonFiles(); }}
          disabled={disabled || mutationsDisabled}
          title={lockReason}
          data-testid="people-hide-files"
        >
          {dictionary.people.hidePersonFiles}
        </MenuItem>
        <MenuItem
          onClick={() => { setMenuAnchor(null); onTrashPersonFiles(); }}
          disabled={disabled || mutationsDisabled}
          title={lockReason}
          data-testid="people-trash-files"
          sx={{ color: 'error.main' }}
        >
          {dictionary.people.trashPersonFiles}
        </MenuItem>
      </Menu>
    </Box>
    <CardContent
      sx={{ p: 1.25, flex: 1, cursor: 'pointer' }}
      onClick={onOpen}
      data-testid="people-card-body"
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={name}>{name}</Typography>
      <Typography variant="caption">{personFileCountLabel(dictionary.people, person, media)}</Typography>
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
