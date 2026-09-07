import { Box, Skeleton } from '@mui/material';

const CARD_HEIGHT = 210;

export const CardGridSkeleton = ({ label, testId, cards = 8 }: { label: string; testId: string; cards?: number }) => (
  <Box
    data-testid={testId}
    role="status"
    aria-label={label}
    sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1.5 }}
  >
    {Array.from({ length: cards }, (_, index) => (
      <Skeleton
        key={`${testId}-${String(index)}`}
        variant="rectangular"
        animation="wave"
        data-testid={`${testId}-card`}
        sx={{ height: CARD_HEIGHT, borderRadius: 1 }}
      />
    ))}
  </Box>
);
