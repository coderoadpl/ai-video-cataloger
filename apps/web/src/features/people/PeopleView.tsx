import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Snackbar,
  TextField,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';

import { ApiError, invalidateLibraryVisibilityConsumers, isTerminalJobStatus } from '@core/client/index.js';
import { libraryTrashSummaryOfDetails } from '@core/contract/index.js';

import { actions } from '../../api.js';
import { CardGridSkeleton } from '../../components/ui/CardGridSkeleton.js';
import { ConfirmDialog } from '../../components/ui/dialogs/ConfirmDialog.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { MoreVertIcon } from '../../components/ui/icons.js';
import { MediaFilterToggle } from '../../components/ui/MediaFilterToggle.js';
import { NoticePanel } from '../../components/ui/NoticePanel.js';
import { PageHeader } from '../../components/ui/PageHeader.js';
import { PlaceholderTile } from '../../components/ui/PlaceholderTile.js';
import { SliderField } from '../../components/ui/SliderField.js';
import { TrashConfirmationDialog, type TrashConfirmationCounts, type TrashConfirmationRoot } from '../../components/ui/dialogs/TrashConfirmationDialog.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import { mediaUrl } from '../../lib/media-url.js';
import { pollJobUntilTerminal, sleep } from '../../lib/poll-job.js';
import { useGuardedCallback, useMountGuard } from '../../components/ui/use-mount-guard.js';
import { readStorageItem, writeStorageItem } from '../../lib/persistent-storage.js';
import {
  defaultMergeTarget,
  mergeNameChoices,
  mergePlanFor,
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
  onOpenInCollection: (personId: string, label: string, media: PeopleMedia) => void;
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

const MERGE_HINT_ID = 'people-merge-hint';
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
  onOpenInCollection,
  renderPersonMedia,
  lockReason,
  intervalMs,
}: PeopleViewProps) => {
  const dictionary = useDictionary();
  const focusOnMount = useCallback((node: HTMLInputElement | null) => node?.focus(), []);
  const queryClient = useQueryClient();
  const guard = useMountGuard();
  const log = useGuardedCallback(guard, addLine);
  const people = usePeople({ active, folder, addLine, ...(intervalMs === undefined ? {} : { intervalMs }) });
  const mutationsBlocked = lockReason !== undefined;
  const [rename, setRename] = useState<RenameState | null>(null);
  const [forgetTarget, setForgetTarget] = useState<FacePerson | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [chosenNamePersonId, setChosenNamePersonId] = useState<string | null>(null);
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
  const nameChoices = mergeNameChoices(selected);
  const defaultTargetId = defaultMergeTarget(selected)?.personId ?? null;
  const mergeTargetId = mergeOpen ? chosenNamePersonId ?? defaultTargetId : defaultTargetId;
  const mergePlan = mergeTargetId === null ? null : mergePlanFor(selected, mergeTargetId);
  const canMerge = defaultTargetId !== null && mergePlanFor(selected, defaultTargetId) !== null;
  const libraryActionScope = libraryAction === null
    ? { kind: 'person' as const, personId: 'preview-placeholder', skipSharedWithOtherPeople: false }
    : {
      kind: 'person' as const,
      personId: libraryAction.personId,
      skipSharedWithOtherPeople: libraryAction.skipSharedWithOtherPeople,
    };
  const libraryActionSharedScope = libraryAction === null
    ? libraryActionScope
    : { kind: 'person' as const, personId: libraryAction.personId, skipSharedWithOtherPeople: false };
  const libraryActionPreview = useQuery({
    ...actions.librarySelectionPreview({ scope: libraryActionScope }),
    enabled: active && libraryAction !== null,
  });
  const libraryActionSharedPreview = useQuery({
    ...actions.librarySelectionPreview({ scope: libraryActionSharedScope }),
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
      libraryActionSharedPreview.data?.sharedWithOtherPeople ?? libraryActionPreview.data.sharedWithOtherPeople,
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
        if (!guard.isMounted()) return;
        log(dictionary.people.hiddenPersonFilesLog(libraryAction.name), 'success');
        await invalidateLibraryVisibilityConsumers(queryClient);
        closeLibraryAction();
      } catch (error) {
        if (guard.isMounted()) setLibraryActionError(`${dictionary.people.hidePersonFilesFailedLog}: ${messageOf(error)}`);
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
            shouldStop: () => !guard.isMounted(),
            signal: guard.signal(),
          });
          if (final.status !== 'completed') {
            throw new ApiError(final.error ?? { code: 'internal', message: dictionary.people.trashPersonFilesFailedLog });
          }
        }
        if (!guard.isMounted()) return;
        log(dictionary.people.trashPersonFilesLog(libraryAction.name), 'success');
        closeLibraryAction();
      } catch (error) {
        if (!guard.isMounted()) return;
        const summary = error instanceof ApiError ? libraryTrashSummaryOfDetails(error.appError.details) : null;
        setLibraryActionError(summary === null
          ? `${dictionary.people.trashPersonFilesFailedLog}: ${messageOf(error)}`
          : `${dictionary.people.trashPersonFilesFailedLog}: ${dictionary.library.trashIncompleteCounts(summary.filesTrashed, summary.filesFailed, summary.filesNotAttempted)}`);
      } finally {
        if (guard.isMounted()) await invalidateLibraryVisibilityConsumers(queryClient);
      }
    })();
  };

  const visibleSelectedCount = selected.filter(
    (person) => gridPeople.some((visible) => visible.personId === person.personId),
  ).length;
  const hiddenSelectedCount = selected.length - visibleSelectedCount;
  const hasCachedPeople = people.people.length > 0;
  const initialError = people.error !== null && !hasCachedPeople
    ? formatAnalyzerError(people.error, dictionary.errors)
    : null;
  const refreshError = people.error !== null && hasCachedPeople
    ? formatAnalyzerError(people.error, dictionary.errors)
    : null;
  const mediumEmpty = hasCachedPeople && gridPeople.length === 0 && !foldedOpen && media !== 'all';

  if (!active) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <PageHeader
        testId="people-header"
        title={dictionary.people.title}
        subtitle={(
          <Box component="span" data-testid={foldedOpen ? 'people-scope' : undefined}>
            {foldedOpen ? dictionary.people.otherPeopleScope : dictionary.people.subtitle}
          </Box>
        )}
        actions={(
          <>
            <Box sx={{ width: { xs: '100%', sm: 220 } }}>
              <SliderField
                label={dictionary.people.minObservationThresholdAria}
                valueLabel={String(minObservations)}
                testId="people-threshold-slider"
                min={0}
                max={PEOPLE_MIN_OBSERVATION_OPTIONS.length - 1}
                step={1}
                marks={peopleMinObservationSliderMarks}
                value={peopleMinObservationIndex(minObservations)}
                valueLabelFormat={(current) => String(peopleMinObservationAtIndex(current) ?? '')}
                getAriaValueText={(current) => {
                  const threshold = peopleMinObservationAtIndex(current);
                  return threshold === null ? '' : dictionary.people.minObservationThreshold(threshold);
                }}
                onChange={(next) => {
                  const threshold = peopleMinObservationAtIndex(next);
                  if (threshold !== null) setMinObservations(threshold);
                }}
              />
            </Box>
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
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
              <Button
                variant="outlined"
                size="small"
                disabled={!canMerge || people.isBusy || mutationsBlocked}
                title={lockReason}
                {...(selected.length === 1 ? { 'aria-describedby': MERGE_HINT_ID } : {})}
                onClick={() => {
                  people.clearMergeError();
                  setChosenNamePersonId(null);
                  setMergeOpen(true);
                }}
                data-testid="people-merge-selected"
              >
                {dictionary.people.mergeSelected}
              </Button>
              {selected.length === 1 ? (
                <Typography id={MERGE_HINT_ID} variant="caption" data-testid="people-merge-hint">
                  {dictionary.people.mergeSelectHint}
                </Typography>
              ) : null}
            </Box>
          </>
        )}
      >
        {selected.length === 0 ? null : (
          <Box
            data-testid="people-selection-bar"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
          >
            <Typography variant="subtitle2" data-testid="people-selection-count">
              {dictionary.people.selectionCount(selected.length)}
            </Typography>
            {hiddenSelectedCount === 0 ? null : (
              <Typography variant="caption" data-testid="people-selection-hidden-count">
                {dictionary.people.hiddenSelectionCount(hiddenSelectedCount)}
              </Typography>
            )}
            <Button
              size="small"
              variant="outlined"
              onClick={people.clearSelected}
              data-testid="people-clear-selection"
            >
              {dictionary.people.clearSelection}
            </Button>
          </Box>
        )}
      </PageHeader>

      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, p: 3, gap: 2.5 }}>
      {refreshError === null ? null : (
        <NoticePanel testId="people-refresh-error" message={refreshError} />
      )}
      {people.activeJobLabel === null ? null : (
        <NoticePanel testId="people-active-job" message={people.activeJobLabel} />
      )}
      {mutationsBlocked && lockReason !== undefined ? (
        <NoticePanel testId="people-read-only" message={lockReason} />
      ) : null}

      {people.isLoading ? (
        <CardGridSkeleton testId="people-loading" label={dictionary.people.loadingPeople} />
      ) : initialError !== null ? (
        <EmptyState
          testId="people-error-state"
          title={dictionary.people.loadFailedTitle}
          body={initialError}
          action={(
            <Button variant="outlined" onClick={people.refresh} data-testid="people-retry">
              {dictionary.common.retry}
            </Button>
          )}
        />
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
                  onOpenInCollection={() => onOpenInCollection(person.personId, name, media)}
                  onPreviewFiles={() => setOpenPerson({ personId: person.personId, label: name })}
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
          {mediumEmpty ? (
            <EmptyState
              testId="people-media-empty"
              title={dictionary.people.mediaEmptyTitle}
              body={dictionary.people.mediaEmptyBody}
              action={(
                <Button variant="outlined" onClick={() => setMedia('all')} data-testid="people-media-empty-show-all">
                  {dictionary.people.showAllMedia}
                </Button>
              )}
            />
          ) : null}
          <Divider />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="people-danger-area">
            <Typography variant="subtitle2">{dictionary.people.dangerArea}</Typography>
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
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (rename === null || rename.value.trim().length === 0) return;
            people.rename(rename.person.personId, rename.value.trim());
            setRename(null);
          }}
        >
          <DialogTitle>{dictionary.people.renameGrouping}</DialogTitle>
          <DialogContent>
            <TextField
              inputRef={focusOnMount}
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
            <Button variant="outlined" type="button" onClick={() => setRename(null)}>{dictionary.common.cancel}</Button>
            <Button
              variant="contained"
              type="submit"
              disabled={rename === null || rename.value.trim().length === 0 || people.isBusy || mutationsBlocked}
              title={lockReason}
              data-testid="people-rename-save"
            >
              {dictionary.common.save}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={mergeOpen} onClose={() => setMergeOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{dictionary.people.mergeGroupings}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {mergePlan === null ? null : (
            <>
              <DialogContentText data-testid="people-merge-body">
                {dictionary.people.mergeBody(selected.length, displayName(dictionary, mergePlan.target))}
              </DialogContentText>
              <DialogContentText data-testid="people-merge-selected-names">
                {dictionary.people.mergeSelectedNames(
                  selected.map((person) => displayName(dictionary, person)).join(', '),
                )}
              </DialogContentText>
            </>
          )}
          {nameChoices.length < 2 ? null : (
            <FormControl>
              <FormLabel id="people-merge-name-label">{dictionary.people.mergeNameChoice}</FormLabel>
              <RadioGroup
                aria-labelledby="people-merge-name-label"
                value={mergeTargetId ?? ''}
                onChange={(event) => setChosenNamePersonId(event.target.value)}
              >
                {nameChoices.map((person) => (
                  <FormControlLabel
                    key={person.personId}
                    value={person.personId}
                    label={displayName(dictionary, person)}
                    control={<Radio />}
                  />
                ))}
              </RadioGroup>
            </FormControl>
          )}
          {people.mergeError === null ? null : (
            <Alert severity="error" data-testid="people-merge-error">{people.mergeError}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setMergeOpen(false)}>{dictionary.common.cancel}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={mergePlan === null || people.isBusy || mutationsBlocked}
            data-testid="people-merge-confirm"
            onClick={() => {
              if (mergePlan === null) return;
              void people
                .merge({
                  toPersonId: mergePlan.target.personId,
                  fromPersonIds: mergePlan.sources.map((person) => person.personId),
                })
                .then((merged) => {
                  if (merged) setMergeOpen(false);
                });
            }}
          >
            {dictionary.people.merge}
          </Button>
        </DialogActions>
      </Dialog>

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
            variant="outlined"
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
          <Button variant="outlined" onClick={closeLibraryAction}>{dictionary.common.cancel}</Button>
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

      </Box>

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
  onOpenInCollection: () => void;
  onPreviewFiles: () => void;
  onHidePersonFiles: () => void;
  onTrashPersonFiles: () => void;
}

const PersonCardView = ({
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
  onOpenInCollection,
  onPreviewFiles,
  onHidePersonFiles,
  onTrashPersonFiles,
}: PersonCardProps) => {
  const dictionary = useDictionary();
  const exemplarUrl = person.exemplarCropPath === null
    ? null
    : mediaUrl(person.exemplarCropPath, person.exemplarCount);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const cropUrl = exemplarUrl === failedUrl ? null : exemplarUrl;

  return (
  <Card
    variant="outlined"
    className="people-card"
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
      <ButtonBase
        data-testid="people-card-media"
        aria-label={dictionary.people.previewFiles}
        onClick={onPreviewFiles}
        sx={{ width: '100%', height: '100%', display: 'block' }}
      >
        {cropUrl === null ? (
          <PlaceholderTile
            testId="people-card-fallback"
            name={person.personId}
            glyph={fallbackGlyph}
          />
        ) : (
          <Box
            component="img"
            loading="lazy"
            alt={name}
            src={cropUrl}
            onError={() => setFailedUrl(exemplarUrl)}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </ButtonBase>
      <Checkbox
        checked={selected}
        disabled={disabled}
        onChange={onToggle}
        slotProps={{ input: { 'aria-label': dictionary.people.selectPerson(name) } }}
        sx={{
          position: 'absolute',
          top: 4,
          left: 4,
          bgcolor: 'background.paper',
          borderRadius: 1,
          opacity: selected ? 1 : 0,
          pointerEvents: selected ? 'auto' : 'none',
          transition: 'opacity 120ms ease',
          '&:hover': { bgcolor: 'background.paper' },
          '.people-card:hover &': { opacity: 1, pointerEvents: 'auto' },
          '.people-card:focus-within &': { opacity: 1, pointerEvents: 'auto' },
        }}
      />
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
          onClick={() => { setMenuAnchor(null); onOpenInCollection(); }}
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
      component="button"
      type="button"
      sx={{
        p: 1.25,
        flex: 1,
        cursor: 'pointer',
        display: 'block',
        width: '100%',
        border: 0,
        bgcolor: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
      }}
      onClick={onOpenInCollection}
      data-testid="people-card-body"
    >
      <Typography variant="subtitle2" noWrap title={name}>{name}</Typography>
      <Typography variant="caption">{personFileCountLabel(dictionary.people, person, media)}</Typography>
    </CardContent>
  </Card>
  );
};

const PersonCard = memo(PersonCardView);

