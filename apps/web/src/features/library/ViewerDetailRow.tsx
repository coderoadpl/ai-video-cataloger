import { Box, Typography } from '@mui/material';

interface ViewerDetailRowProps {
  label: string;
  value: string | null;
  testId?: string;
}

export const ViewerDetailRow = ({ label, value, testId }: ViewerDetailRowProps) => {
  if (value === null || value.length === 0) return null;
  return (
    <Box {...(testId === undefined ? {} : { 'data-testid': testId })}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>
  );
};
