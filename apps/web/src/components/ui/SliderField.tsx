import { Box, Slider, Typography } from '@mui/material';

interface SliderMark {
  value: number;
  label: string;
}

interface SliderFieldProps {
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  testId: string;
  helper?: string;
  marks?: SliderMark[];
  valueLabelFormat?: ((value: number) => string) | undefined;
  getAriaValueText?: ((value: number) => string) | undefined;
}

export const SliderField = ({
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  onChange,
  testId,
  helper,
  marks,
  valueLabelFormat,
  getAriaValueText,
}: SliderFieldProps) => (
  <Box data-testid={`${testId}-field`}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Typography variant="subtitle2">{label}</Typography>
      <Typography variant="caption">{valueLabel}</Typography>
    </Box>
    <Slider
      size="small"
      sx={valueLabelFormat === undefined ? undefined : { mt: 4 }}
      aria-label={label}
      data-testid={testId}
      min={min}
      max={max}
      step={step}
      value={value}
      {...(marks === undefined ? {} : { marks })}
      {...(valueLabelFormat === undefined ? {} : { valueLabelDisplay: 'auto' as const, valueLabelFormat })}
      {...(getAriaValueText === undefined ? {} : { getAriaValueText })}
      onChange={(_event, next) => {
        if (typeof next !== 'number') return;
        onChange(next);
      }}
    />
    {helper === undefined ? null : <Typography variant="caption">{helper}</Typography>}
  </Box>
);
