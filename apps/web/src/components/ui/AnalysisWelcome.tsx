import { Box, List, ListItem, Paper, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

export const AnalysisWelcome = () => {
  const dictionary = useDictionary();

  return (
    <Box sx={{ p: 4, maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">{dictionary.details.welcomeTitle}</Typography>
        <Typography variant="body2" color="text.secondary">
          {dictionary.details.welcomeBody}
        </Typography>
      </Box>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h2" gutterBottom>
          {dictionary.details.gettingStarted}
        </Typography>
        <List dense sx={{ listStyleType: 'decimal', pl: 2.5 }}>
          {dictionary.details.gettingStartedSteps.map((step) => (
            <ListItem key={step} sx={{ display: 'list-item', py: 0.25, px: 0 }} disableGutters>
              <Typography variant="body2" color="text.secondary">
                {step}
              </Typography>
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  );
};
