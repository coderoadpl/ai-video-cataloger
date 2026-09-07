import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material';

import { EmptyState } from '../../components/ui/EmptyState.js';
import { PlaceholderTile } from '../../components/ui/PlaceholderTile.js';
import { personLabel } from '../../i18n/person-label.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { mergeNameChoices, personTotalsLabel } from './core/index.js';
import type { FacesPairCandidate, FacesPairPerson, PeoplePairsState } from './use-people-pairs.js';

interface PairReviewProps {
  state: PeoplePairsState;
  disabled: boolean;
  lockReason: string | undefined;
}

const reviewKey = (event: KeyboardEvent): '1' | '2' | '3' | 'Backspace' | null => {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === '1' || event.key === '2' || event.key === '3' || event.key === 'Backspace') return event.key;
  return null;
};

const keyboardIsClaimedElsewhere = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('[role="dialog"]') !== null) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

export const PairReview = ({ state, disabled, lockReason }: PairReviewProps) => {
  const dictionary = useDictionary();
  const [confirming, setConfirming] = useState<FacesPairCandidate | null>(null);
  const [chosenNamePersonId, setChosenNamePersonId] = useState<string | null>(null);
  const current = state.current;
  const blocked = disabled || state.isBusy;

  const askSame = (): void => {
    if (current === null) return;
    if (current.a.displayName !== null && current.b.displayName !== null) {
      setChosenNamePersonId(current.survivorIfSame);
      setConfirming(current);
      return;
    }
    state.decide('same');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = reviewKey(event);
      if (key === null || keyboardIsClaimedElsewhere(event.target) || blocked) return;
      event.preventDefault();
      if (key === '1') askSame();
      if (key === '2') state.decide('different');
      if (key === '3') state.decide('skip');
      if (key === 'Backspace' && state.canUndo) state.undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (current === null) {
    return (
      <Box data-testid="people-pair-review" sx={{ display: 'flex', flexDirection: 'column' }}>
        <EmptyState
          testId="people-pair-review-empty"
          title={dictionary.people.pairReviewEmptyTitle}
          body={dictionary.people.pairReviewEmptyBody}
        />
      </Box>
    );
  }

  const nameChoices = confirming === null ? [] : mergeNameChoices([confirming.a, confirming.b]);

  return (
    <Box data-testid="people-pair-review" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h2" data-testid="people-pair-review-question">
          {dictionary.people.pairReviewQuestion}
        </Typography>
        <Typography variant="body2" data-testid="people-pair-review-position">
          {dictionary.people.pairReviewPosition(
            state.answeredThisSession + 1,
            state.answeredThisSession + state.queueLength,
          )}
        </Typography>
        {state.truncated ? (
          <Typography variant="caption" data-testid="people-pair-review-truncated">
            {dictionary.people.pairReviewTruncated(state.limit)}
          </Typography>
        ) : null}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        <PairPersonPanel testId="people-pair-review-person-a" person={current.a} />
        <PairPersonPanel testId="people-pair-review-person-b" person={current.b} />
      </Box>

      {state.error === null ? null : (
        <Alert severity="error" data-testid="people-pair-review-error">{state.error}</Alert>
      )}
      {state.notUndoable ? (
        <Alert severity="info" data-testid="people-pair-review-not-undoable">
          {dictionary.people.pairReviewNotUndoable}
        </Alert>
      ) : null}

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <AnswerButton
          testId="people-pair-review-same"
          label={dictionary.people.pairReviewSame}
          hint={dictionary.people.pairReviewKeyHint('1')}
          disabled={blocked}
          lockReason={lockReason}
          onClick={askSame}
        />
        <AnswerButton
          testId="people-pair-review-different"
          label={dictionary.people.pairReviewDifferent}
          hint={dictionary.people.pairReviewKeyHint('2')}
          caption={dictionary.people.pairReviewDifferentCaption}
          disabled={blocked}
          lockReason={lockReason}
          onClick={() => state.decide('different')}
        />
        <AnswerButton
          testId="people-pair-review-skip"
          label={dictionary.people.pairReviewSkip}
          hint={dictionary.people.pairReviewKeyHint('3')}
          disabled={blocked}
          lockReason={lockReason}
          onClick={() => state.decide('skip')}
        />
        <Button
          variant="text"
          size="small"
          disabled={blocked || !state.canUndo}
          title={lockReason}
          onClick={state.undo}
          data-testid="people-pair-review-undo"
        >
          {dictionary.people.pairReviewUndo}
        </Button>
      </Box>

      <Dialog open={confirming !== null} onClose={() => setConfirming(null)} fullWidth maxWidth="xs">
        <DialogTitle>{dictionary.people.pairReviewConfirmTitle}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="people-pair-review-confirm">
          {confirming === null ? null : (
            <DialogContentText>
              {dictionary.people.pairReviewConfirmBody(
                personLabel(dictionary, confirming.a),
                personLabel(dictionary, confirming.b),
              )}
            </DialogContentText>
          )}
          <FormControl>
            <FormLabel id="people-pair-review-name-label">{dictionary.people.mergeNameChoice}</FormLabel>
            <RadioGroup
              aria-labelledby="people-pair-review-name-label"
              value={chosenNamePersonId ?? ''}
              onChange={(event) => setChosenNamePersonId(event.target.value)}
            >
              {nameChoices.map((person) => (
                <FormControlLabel
                  key={person.personId}
                  value={person.personId}
                  label={personLabel(dictionary, person)}
                  control={<Radio />}
                />
              ))}
            </RadioGroup>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setConfirming(null)}>{dictionary.common.cancel}</Button>
          <Button
            variant="contained"
            disabled={blocked || chosenNamePersonId === null}
            data-testid="people-pair-review-confirm-accept"
            onClick={() => {
              if (chosenNamePersonId === null) return;
              state.decide('same', chosenNamePersonId);
              setConfirming(null);
            }}
          >
            {dictionary.people.merge}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const PairPersonPanel = ({ testId, person }: { testId: string; person: FacesPairPerson }) => {
  const dictionary = useDictionary();
  const name = personLabel(dictionary, person);

  return (
    <Card variant="outlined" data-testid={testId} data-person-id={person.personId}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="subtitle2" noWrap title={name}>{name}</Typography>
        <Typography variant="caption">{personTotalsLabel(dictionary.people, person)}</Typography>
        {person.cropPaths.length === 0 ? (
          <Box sx={{ height: 120 }}>
            <PlaceholderTile
              testId={`${testId}-fallback`}
              name={person.personId}
              glyph={person.displayName === null ? String(person.fallbackIndex + 1) : name.charAt(0)}
            />
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75 }}>
            {person.cropPaths.map((cropPath) => (
              <Box
                key={cropPath}
                component="img"
                loading="lazy"
                data-testid="people-pair-review-crop"
                alt={dictionary.people.pairReviewCrop(name)}
                src={mediaUrl(cropPath)}
                sx={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 1 }}
              />
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

interface AnswerButtonProps {
  testId: string;
  label: string;
  hint: string;
  caption?: string;
  disabled: boolean;
  lockReason: string | undefined;
  onClick: () => void;
}

const AnswerButton = ({ testId, label, hint, caption, disabled, lockReason, onClick }: AnswerButtonProps) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
    <Button
      variant="contained"
      disabled={disabled}
      title={lockReason}
      onClick={onClick}
      data-testid={testId}
    >
      {label}
    </Button>
    <Typography variant="caption">{hint}</Typography>
    {caption === undefined ? null : <Typography variant="caption">{caption}</Typography>}
  </Box>
);
