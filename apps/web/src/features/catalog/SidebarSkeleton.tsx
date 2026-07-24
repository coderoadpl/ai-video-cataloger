import { Box, Skeleton } from '@mui/material';

const SkeletonRow = ({ indent }: { indent: number }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1, pl: `${indent * 18 + 8}px` }}>
    <Skeleton variant="rounded" width={56} height={56} />
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Skeleton variant="text" width="70%" />
      <Skeleton variant="text" width="40%" />
    </Box>
  </Box>
);

export const SidebarSkeleton = () => (
  <Box sx={{ p: 1 }} data-testid="sidebar-skeleton" aria-busy="true">
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.5, pl: 1 }}>
      <Skeleton variant="circular" width={18} height={18} />
      <Skeleton variant="text" width="45%" />
    </Box>
    <SkeletonRow indent={1} />
    <SkeletonRow indent={1} />
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.5, pl: `${18 + 8}px` }}>
      <Skeleton variant="circular" width={18} height={18} />
      <Skeleton variant="text" width="35%" />
    </Box>
    <SkeletonRow indent={2} />
  </Box>
);
