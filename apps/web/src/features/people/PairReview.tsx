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
  onBack: () => void;
}

interface PairAnswer {
  testId: string;
  variant: 'contained' | 'outlined' | 'text';
  label: string;
  hint: string;
  caption?: string;
  onClick: () => void;
}

const describedBy = (answer: PairAnswer): string =>
  answer.caption === undefined ? `${answer.testId}-hint` : `${answer.testId}-hint ${answer.testId}-caption`;

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

export const PairReview = ({ state, disabled, lockReason, onBack }: PairReviewProps) => {
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
    const done = state.answeredThisSession > 0;
    return (
      <Box data-testid="people-pair-review" sx={{ display: 'flex', flexDirection: 'column' }}>
        <EmptyState
          testId={done ? 'people-pair-review-done' : 'people-pair-review-empty'}
          title={done ? dictionary.people.pairReviewDoneTitle : dictionary.people.pairReviewEmptyTitle}
          body={done ? dictionary.people.pairReviewDoneBody(state.answeredThisSession) : dictionary.people.pairReviewEmptyBody}
          {...(done
            ? {
                action: (
                  <Button variant="contained" onClick={onBack} data-testid="people-pair-review-done-back">
                    {dictionary.people.backToMainPeople}
                  </Button>
                ),
              }
            : {})}
        />
      </Box>
    );
  }

  const answers: PairAnswer[] = [
    {
      testId: 'people-pair-review-same',
      variant: 'contained',
      label: dictionary.people.pairReviewSame,
      hint: dictionary.people.pairReviewKeyHint('1'),
      onClick: askSame,
    },
    {
      testId: 'people-pair-review-different',
      variant: 'outlined',
      label: dictionary.people.pairReviewDifferent,
      hint: dictionary.people.pairReviewKeyHint('2'),
      caption: dictionary.people.pairReviewDifferentCaption,
      onClick: () => state.decide('different'),
    },
    {
      testId: 'people-pair-review-skip',
      variant: 'text',
      label: dictionary.people.pairReviewSkip,
      hint: dictionary.people.pairReviewKeyHint('3'),
      caption: dictionary.people.pairReviewSkipCaption,
      onClick: () => state.decide('skip'),
    },
  ];

  const nameChoices = confirming === null ? [] : mergeNameChoices([confirming.a, confirming.b]);

  return (
    <Box data-testid="people-pair-review" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h2" data-testid="people-pair-review-question">
          {dictionary.people.pairReviewQuestion}
        </Typography>
        <Typography variant="body2" role="status" aria-live="polite" data-testid="people-pair-review-position">
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

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {answers.map((answer) => (
            <Box key={answer.testId} sx={{ flex: 1 }}>
              <Button
                fullWidth
                variant={answer.variant}
                disabled={blocked}
                title={lockReason}
                aria-describedby={describedBy(answer)}
                onClick={answer.onClick}
                data-testid={answer.testId}
              >
                {answer.label}
              </Button>
            </Box>
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          {answers.map((answer) => (
            <Box key={answer.testId} sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography id={`${answer.testId}-hint`} variant="caption">{answer.hint}</Typography>
              {answer.caption === undefined ? null : (
                <Typography id={`${answer.testId}-caption`} variant="caption">{answer.caption}</Typography>
              )}
            </Box>
          ))}
        </Box>
        <Box>
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
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75 }}>
          {person.cropPaths.length === 0 ? (
            <Box sx={{ aspectRatio: '1 / 1' }}>
              <PlaceholderTile
                testId={`${testId}-fallback`}
                name={person.personId}
                glyph={person.displayName === null ? String(person.fallbackIndex + 1) : name.charAt(0)}
              />
            </Box>
          ) : (
            person.cropPaths.map((cropPath) => (
              <Box
                key={cropPath}
                component="img"
                loading="lazy"
                data-testid="people-pair-review-crop"
                alt={dictionary.people.pairReviewCrop(name)}
                src={mediaUrl(cropPath)}
                sx={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 1 }}
              />
            ))
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

