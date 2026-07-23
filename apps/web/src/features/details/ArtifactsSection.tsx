import { type ReactNode } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Paper, Typography } from '@mui/material';

import { DescriptionIcon, ImageIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { type DetailsVideo } from './details-video.js';
import { FrameGallery } from './FrameGallery.js';

const CardHeader = ({ icon, title }: { icon: ReactNode; title: string }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
    <Typography variant="h2">{title}</Typography>
  </Box>
);

export const ArtifactsSection = ({ video }: { video: DetailsVideo }) => {
  const dictionary = useDictionary();
  const { framePaths, transcriptContent, summary } = video.artifacts;
  const frames = framePaths ?? [];
  const hasFrames = frames.length > 0;
  const hasTranscript = transcriptContent !== null && transcriptContent.length > 0;
  const summaryExpected = video.status === 'analyzed' || video.status === 'completed';

  if (!(summary !== null || hasTranscript || hasFrames || summaryExpected)) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {summary !== null ? (
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <CardHeader icon={<DescriptionIcon fontSize="small" />} title={dictionary.details.summary} />
          <Typography variant="body2">{summary.description}</Typography>
          {summary.suggestedFilename.length > 0 ? (
            <Typography variant="caption">
              {dictionary.details.suggestedFilename}{' '}
              <Box
                component="code"
                sx={{ bgcolor: 'action.hover', px: 0.75, py: 0.25, borderRadius: 0.5 }}
              >
                {summary.suggestedFilename}
              </Box>
            </Typography>
          ) : null}
        </Paper>
      ) : null}

      {summary === null && summaryExpected ? (
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <CardHeader icon={<DescriptionIcon fontSize="small" />} title={dictionary.details.summary} />
          <Typography variant="body2" color="text.secondary">
            {dictionary.details.noSummaryAvailable}
          </Typography>
        </Paper>
      ) : null}

      {hasFrames ? (
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <CardHeader icon={<ImageIcon fontSize="small" />} title={dictionary.details.extractedFrames(frames.length)} />
          <FrameGallery key={video.path} framePaths={frames} />
        </Paper>
      ) : null}

      {hasTranscript ? (
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <CardHeader icon={<DescriptionIcon fontSize="small" />} title={dictionary.details.transcript} />
          <Box sx={{ maxHeight: 256, overflowY: 'auto' }}>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
              {transcriptContent}
            </Typography>
          </Box>
        </Paper>
      ) : null}

      {summary !== null && summary.fullAnalysis.length > 0 ? (
        <Accordion variant="outlined" disableGutters>
          <AccordionSummary>
            <Typography variant="h2">{dictionary.details.fullAiAnalysis}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
              {summary.fullAnalysis}
            </Typography>
          </AccordionDetails>
        </Accordion>
      ) : null}
    </Box>
  );
};
