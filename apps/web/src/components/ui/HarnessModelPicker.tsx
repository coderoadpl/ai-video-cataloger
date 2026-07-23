import { useState } from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';

const DEFAULT_VALUE = '';
const CUSTOM_VALUE = '__custom__';

const EFFORT_OPTIONS = ['low', 'medium', 'high'];

const isEffortOption = (value: string): boolean => EFFORT_OPTIONS.includes(value);

export interface HarnessModelPickerProps {
  harnessId: string;
  curatedModels: readonly string[];
  model: string;
  onModelChange: (model: string) => void;
  effort?: string;
  onEffortChange?: (effort: string) => void;
}

export const HarnessModelPicker = ({
  harnessId,
  curatedModels,
  model,
  onModelChange,
  effort,
  onEffortChange,
}: HarnessModelPickerProps) => {
  const trimmed = model.trim();
  const isCurated = curatedModels.includes(trimmed);
  const [customMode, setCustomMode] = useState(trimmed.length > 0 && !isCurated);
  const selectValue = customMode ? CUSTOM_VALUE : isCurated ? trimmed : DEFAULT_VALUE;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="harness-model-picker">
      <FormControl fullWidth size="small">
        <InputLabel id={`harness-model-${harnessId}`}>Model</InputLabel>
        <Select
          labelId={`harness-model-${harnessId}`}
          label="Model"
          value={selectValue}
          data-testid="harness-model-select"
          onChange={(event) => {
            const value = event.target.value;
            if (value === CUSTOM_VALUE) {
              setCustomMode(true);
              return;
            }
            setCustomMode(false);
            onModelChange(value === DEFAULT_VALUE ? '' : value);
          }}
        >
          <MenuItem value={DEFAULT_VALUE}>Default (CLI-configured)</MenuItem>
          {curatedModels.map((id) => (
            <MenuItem key={id} value={id}>
              {id}
            </MenuItem>
          ))}
          <MenuItem value={CUSTOM_VALUE}>Advanced: custom model id…</MenuItem>
        </Select>
      </FormControl>
      {customMode ? (
        <>
          <TextField
            size="small"
            label="Custom model id"
            value={model}
            data-testid="harness-model-custom"
            onChange={(event) => onModelChange(event.target.value)}
          />
          <Typography variant="caption" color="warning.main" data-testid="harness-model-unvalidated">
            Unvalidated — this id is passed to the CLI as-is and is not checked against a known list.
          </Typography>
        </>
      ) : null}
      {onEffortChange === undefined ? null : (
        <FormControl fullWidth size="small">
          <InputLabel id={`harness-effort-${harnessId}`}>Reasoning effort</InputLabel>
          <Select
            labelId={`harness-effort-${harnessId}`}
            label="Reasoning effort"
            value={effort !== undefined && isEffortOption(effort) ? effort : DEFAULT_VALUE}
            data-testid="harness-effort-select"
            onChange={(event) => onEffortChange(event.target.value === DEFAULT_VALUE ? '' : event.target.value)}
          >
            <MenuItem value={DEFAULT_VALUE}>Default</MenuItem>
            {EFFORT_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </Box>
  );
};
