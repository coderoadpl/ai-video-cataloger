import { Box, Skeleton, Stack } from '@mui/material';

export const DetailsSkeleton = () => (
  <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="details-skeleton" aria-busy="true">
    <Stack spacing={1}>
      <Skeleton variant="text" width="45%" height={40} />
      <Skeleton variant="text" width="25%" />
    </Stack>
    <Skeleton variant="rounded" width="100%" height={220} />
    <Stack direction="row" spacing={1}>
      <Skeleton variant="rounded" width={88} height={28} />
      <Skeleton variant="rounded" width={88} height={28} />
      <Skeleton variant="rounded" width={88} height={28} />
    </Stack>
    <Stack spacing={1}>
      <Skeleton variant="text" width="100%" />
      <Skeleton variant="text" width="92%" />
      <Skeleton variant="text" width="80%" />
    </Stack>
  </Box>
);
