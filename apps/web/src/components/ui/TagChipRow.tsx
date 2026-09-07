import { Box, Chip, Typography } from '@mui/material';

interface TagChipRowProps {
  tags: readonly string[];
  label: string;
  testId: string;
  onTagSearch?: ((tag: string) => void) | undefined;
}

export const TagChipRow = ({ tags, label, testId, onTagSearch }: TagChipRowProps) =>
  tags.length === 0 ? null : (
    <Box data-testid={`${testId}-row`}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }} aria-label={label}>
        {tags.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            data-testid={testId}
            clickable={onTagSearch !== undefined}
            onClick={onTagSearch === undefined ? undefined : () => onTagSearch(tag)}
            sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 500 }}
          />
        ))}
      </Box>
    </Box>
  );
