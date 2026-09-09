import { useState, type MouseEvent } from 'react';
import { Box, Button, Popover, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

import { TuneIcon } from '../../components/ui/icons.js';
import { SliderField } from '../../components/ui/SliderField.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { HEADER_ACTION_CONTROL_SX } from '../../theme.js';
import {
  PEOPLE_MIN_OBSERVATION_OPTIONS,
  pairReviewBadge,
  peopleMinObservationAtIndex,
  peopleMinObservationIndex,
  peopleMinObservationMarks,
  type PeopleMinObservations,
  type PeopleSort,
} from './core/index.js';

const PEOPLE_MERGE_HINT_ID = 'people-merge-hint';

interface PeopleHeaderActionsProps {
  minObservations: PeopleMinObservations;
  onMinObservationsChange: (next: PeopleMinObservations) => void;
  sort: PeopleSort;
  onSortChange: (next: PeopleSort) => void;
  mergeDisabled: boolean;
  mergeHintVisible: boolean;
  onMerge: () => void;
  pairPending: number;
  pairLimit: number;
  pairDisabled: boolean;
  onOpenPairReview: () => void;
  lockReason: string | undefined;
}

export const PeopleHeaderActions = ({
  minObservations,
  onMinObservationsChange,
  sort,
  onSortChange,
  mergeDisabled,
  mergeHintVisible,
  onMerge,
  pairPending,
  pairLimit,
  pairDisabled,
  onOpenPairReview,
  lockReason,
}: PeopleHeaderActionsProps) => {
  const dictionary = useDictionary();
  const [thresholdAnchor, setThresholdAnchor] = useState<HTMLElement | null>(null);
  const badge = pairReviewBadge(pairPending, pairLimit);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
      <Box
        data-testid="people-header-actions"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
      >
        <Button
          variant="outlined"
          size="small"
          sx={HEADER_ACTION_CONTROL_SX}
          startIcon={<TuneIcon fontSize="small" />}
          aria-haspopup="dialog"
          aria-expanded={thresholdAnchor !== null}
          onClick={(event: MouseEvent<HTMLButtonElement>) => setThresholdAnchor(event.currentTarget)}
          data-testid="people-threshold-button"
        >
          {dictionary.people.minObservationButton(minObservations)}
        </Button>
        <ToggleButtonGroup
          size="small"
          exclusive
          sx={HEADER_ACTION_CONTROL_SX}
          value={sort}
          onChange={(_event, next: PeopleSort | null) => { if (next !== null) onSortChange(next); }}
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
          sx={HEADER_ACTION_CONTROL_SX}
          disabled={mergeDisabled}
          title={lockReason}
          {...(mergeHintVisible ? { 'aria-describedby': PEOPLE_MERGE_HINT_ID } : {})}
          onClick={onMerge}
          data-testid="people-merge-selected"
        >
          {dictionary.people.mergeSelected}
        </Button>
        {pairPending === 0 ? null : (
          <Button
            variant="contained"
            size="small"
            sx={HEADER_ACTION_CONTROL_SX}
            disabled={pairDisabled}
            title={lockReason}
            onClick={onOpenPairReview}
            data-testid="people-pair-review-open"
          >
            {dictionary.people.pairReviewOpen(badge.count, badge.truncated)}
          </Button>
        )}
      </Box>
      {mergeHintVisible ? (
        <Typography id={PEOPLE_MERGE_HINT_ID} variant="caption" data-testid="people-merge-hint">
          {dictionary.people.mergeSelectHint}
        </Typography>
      ) : null}
      <Popover
        open={thresholdAnchor !== null}
        anchorEl={thresholdAnchor}
        onClose={() => setThresholdAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': dictionary.people.minObservationThresholdAria,
            sx: { p: 2, width: 280 },
          },
        }}
      >
        <SliderField
          label={dictionary.people.minObservationThresholdAria}
          valueLabel={String(minObservations)}
          testId="people-threshold-slider"
          min={0}
          max={PEOPLE_MIN_OBSERVATION_OPTIONS.length - 1}
          step={1}
          marks={[...peopleMinObservationMarks]}
          helper={dictionary.people.minObservationHint}
          value={peopleMinObservationIndex(minObservations)}
          valueLabelFormat={(current) => String(peopleMinObservationAtIndex(current) ?? '')}
          getAriaValueText={(current) => {
            const threshold = peopleMinObservationAtIndex(current);
            return threshold === null ? '' : dictionary.people.minObservationThreshold(threshold);
          }}
          onChange={(next) => {
            const threshold = peopleMinObservationAtIndex(next);
            if (threshold !== null) onMinObservationsChange(threshold);
          }}
        />
      </Popover>
    </Box>
  );
};
