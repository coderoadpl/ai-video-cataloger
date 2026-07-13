import { type ReactNode } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Paper, Typography } from '@mui/material';

import { DescriptionIcon, ImageIcon } from '../../components/ui/icons.js';
import { type DetailsVideo } from './details-video.js';
import { FrameGallery } from './FrameGallery.js';

const CardHeader = ({ icon, title }: { icon: ReactNode; title: string }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
    <Typography variant="h2">{title}</Typography>
  </Box>
);

/**
 * The artifacts region of the details panel (parity-inventory §2): the summary
 * card (description + suggested filename), a missing-summary empty state for a
 * video that should have one, the extracted-frame gallery, the transcript
 * scroll area, and the collapsible full AI analysis. Each block renders only
 * when its artifact is present.
 */
export const ArtifactsSection = ({ video }: { video: DetailsVideo }) => {
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
          <CardHeader icon={<DescriptionIcon fontSize="small" />} title="Summary" />
          <Typography variant="body2">{summary.description}</Typography>
          {summary.suggestedFilename.length > 0 ? (
            <Typography variant="caption">
              Suggested filename:{' '}
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
          <CardHeader icon={<DescriptionIcon fontSize="small" />} title="Summary" />
          <Typography variant="body2" color="text.secondary">
            No summary available. Run the analysis again to generate it.
          </Typography>
        </Paper>
      ) : null}

      {hasFrames ? (
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <CardHeader icon={<ImageIcon fontSize="small" />} title={`Extracted Frames (${frames.length})`} />
          <FrameGallery key={video.path} framePaths={frames} />
        </Paper>
      ) : null}

      {hasTranscript ? (
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <CardHeader icon={<DescriptionIcon fontSize="small" />} title="Transcript" />
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
            <Typography variant="h2">Full AI Analysis</Typography>
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
