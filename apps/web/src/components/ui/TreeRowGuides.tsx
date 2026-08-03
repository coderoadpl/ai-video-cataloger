import { Box } from '@mui/material';
import type { ReactNode } from 'react';

export interface TreeRowGuideShape {
  depth: number;
  isLast: boolean;
  ancestorContinues: readonly boolean[];
}

const INDENT = 18;

export const TreeRowGuides = ({ row, indent = INDENT }: { row: TreeRowGuideShape; indent?: number }) => {
  if (row.depth === 0) return null;
  const connector = row.depth - 1;
  const lines: ReactNode[] = [];
  for (let level = 0; level < connector; level += 1) {
    if (!row.ancestorContinues[level]) continue;
    lines.push(
      <Box
        key={`v-${String(level)}`}
        sx={(theme) => ({
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: level * indent + indent / 2,
          width: '1px',
          bgcolor: theme.palette.divider,
        })}
      />,
    );
  }
  const x = connector * indent + indent / 2;
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} data-testid="row-guides">
      {lines}
      <Box sx={(theme) => ({ position: 'absolute', top: 0, height: '50%', left: x, width: '1px', bgcolor: theme.palette.divider })} />
      {row.isLast ? null : (
        <Box sx={(theme) => ({ position: 'absolute', top: '50%', bottom: 0, left: x, width: '1px', bgcolor: theme.palette.divider })} />
      )}
      <Box sx={(theme) => ({ position: 'absolute', top: '50%', left: x, width: indent / 2, height: '1px', bgcolor: theme.palette.divider })} />
    </Box>
  );
};
