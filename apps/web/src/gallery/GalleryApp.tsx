import { type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CssBaseline,
  ListItemButton,
  Typography,
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';

import { DuplicateBadge } from '../components/ui/DuplicateBadge.js';
import { FolderIcon, PlayCircleIcon } from '../components/ui/icons.js';
import { MediaThumbnail } from '../components/ui/MediaThumbnail.js';
import { VideoStatusBadge } from '../components/ui/VideoStatusBadge.js';
import { type WhisperModelEntry } from '../features/models/models-model.js';
import { WhisperModelRow } from '../features/models/WhisperModelRow.js';
import { getDict } from '../i18n/dictionary.js';
import { createAppTheme, type ThemeMode } from '../theme.js';
import { type DetailsVideo } from '../features/details/details-video.js';
import {
  VariantCompareView,
  type VariantCompareVariant,
} from '../features/details/VariantCompareView.js';

const dictionary = getDict('en');
const noop = (): void => undefined;

interface Specimen {
  id: string;
  label: string;
  node: ReactNode;
}

const CANONICAL = '/Volumes/Media/Clips/original-take.mp4';

const compareVideo: DetailsVideo = {
  path: '/Volumes/Media/Clips/coastal-market.mp4',
  filename: 'coastal-market.mp4',
  size: 12_000_000,
  sizeFormatted: '12 MB',
  duration: 83,
  durationFormatted: '1:23',
  status: 'completed',
  errorMessage: null,
  contentHash: 'fixture-fingerprint',
  artifacts: {
    framePaths: ['/fixture/first/frame-001.jpg', '/fixture/first/frame-002.jpg'],
    transcriptContent: 'A vendor describes the morning market while customers pass the camera.',
    transcriptPath: '/fixture/first/transcript.txt',
    summary: null,
    summaryPath: '/fixture/first/summary.txt',
    thumbnailPath: null,
    thumbnailMtime: null,
    newFilename: 'coastal-market-morning.mp4',
  },
};

const compareVariants: readonly VariantCompareVariant[] = [
  {
    configId: 'cfg_111111111111',
    descriptor: {
      family: 'local',
      providerId: 'local',
      modelTag: 'gemma3:12b',
      whisper_mode: 'local',
      whisper_model: 'base',
      whisper_language: 'auto',
      frames: 2,
      output_language: 'en',
      promptVersion: 3,
    },
    label: 'local / gemma3:12b',
    createdAt: '2026-08-02T10:00:00.000Z',
    analyzer: 'local',
    model: 'gemma3:12b',
    usage: null,
    estimatedCostUsd: null,
    artifacts: {
      framesDirectory: '/fixture/first',
      transcriptPath: '/fixture/first/transcript.txt',
      summaryPath: '/fixture/first/summary.txt',
    },
    selected: true,
    finalName: 'coastal-market-morning.mp4',
    description: 'A calm walkthrough of a coastal morning market with produce stalls and passing shoppers.',
    transcript: 'A vendor describes the morning market while customers pass the camera.',
    language: 'en',
    tags: ['market', 'coast', 'morning'],
  },
  {
    configId: 'cfg_222222222222',
    descriptor: {
      family: 'gemini-native',
      providerId: 'gemini',
      model: 'gemini-3.6-flash',
      output_language: 'pl',
      promptVersion: 3,
    },
    label: 'gemini / gemini-3.6-flash',
    createdAt: '2026-08-02T10:04:00.000Z',
    analyzer: 'gemini',
    model: 'gemini-3.6-flash',
    usage: { totalTokens: 3210, estimatedCostUsd: 0.0142 },
    estimatedCostUsd: 0.0142,
    artifacts: {
      framesDirectory: null,
      transcriptPath: '/fixture/second/transcript.txt',
      summaryPath: '/fixture/second/summary.txt',
    },
    selected: false,
    finalName: 'poranny-targ-nad-morzem.mp4',
    description: 'Dynamiczny spacer przez nadmorski targ, skupiony na sprzedawcach i lokalnych produktach.',
    transcript: 'Sprzedawca opisuje poranny targ, gdy klienci przechodzą przed kamerą.',
    language: 'pl',
    tags: ['targ', 'wybrzeże', 'poranek'],
  },
];

const fixtureFrameUrl = (path: string): string =>
  path.endsWith('frame-002.jpg') ? '/compare-frame-2.svg' : '/compare-frame-1.svg';

const CompareSpecimen = () => (
  <Box data-testid="gallery-variant-compare" sx={{ border: 1, borderColor: 'divider' }}>
    <VariantCompareView
      video={compareVideo}
      variants={compareVariants}
      selectingConfigId={null}
      actionError={null}
      onBack={noop}
      onSelect={noop}
      frameUrl={fixtureFrameUrl}
      dictionary={dictionary}
    />
  </Box>
);

const badgeSpecimens: readonly Specimen[] = [
  { id: 'badge-pending', label: 'Pending', node: <VideoStatusBadge status="pending" variant="details" /> },
  { id: 'badge-completed', label: 'Completed', node: <VideoStatusBadge status="completed" variant="details" /> },
  { id: 'badge-in-progress', label: 'In progress', node: <VideoStatusBadge status="analyzed" variant="details" /> },
  { id: 'badge-processing', label: 'Processing', node: <VideoStatusBadge status="pending" analyzing variant="details" /> },
  { id: 'badge-error', label: 'Error / missing', node: <VideoStatusBadge status="error" variant="details" /> },
  { id: 'badge-not-tracked', label: 'Not Tracked', node: <VideoStatusBadge status="not_tracked" variant="details" /> },
  { id: 'badge-duplicate', label: 'Duplicate', node: <DuplicateBadge canonicalPath={CANONICAL} /> },
];

const tagSpecimens: readonly Specimen[] = [
  {
    id: 'tag-chips',
    label: 'Tag chips',
    node: (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {['interview', 'b-roll', 'outdoor', 'sunset'].map((tag) => (
          <Chip key={tag} label={tag} size="small" clickable onClick={() => undefined} />
        ))}
      </Box>
    ),
  },
];

const thumbnailSpecimens: readonly Specimen[] = [
  {
    id: 'thumb-placeholder',
    label: 'Placeholder (no thumb)',
    node: <MediaThumbnail path={null} mtime={null} alt="placeholder" width={56} square />,
  },
  {
    id: 'thumb-loading',
    label: 'Loading (generating)',
    node: <MediaThumbnail path={null} mtime={null} alt="loading" width={56} square loading />,
  },
  {
    id: 'thumb-landscape',
    label: 'Landscape box',
    node: <MediaThumbnail path={null} mtime={null} alt="landscape" width={120} source={{ width: 1920, height: 1080, rotation: 0 }} />,
  },
  {
    id: 'thumb-portrait',
    label: 'Portrait box',
    node: <MediaThumbnail path={null} mtime={null} alt="portrait" width={120} source={{ width: 1080, height: 1920, rotation: 0 }} />,
  },
];

const FolderRowSpecimen = () => (
  <ListItemButton sx={{ gap: 0.75, py: 0.5, px: 1, borderRadius: 1 }}>
    <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />
    <Typography variant="body2" noWrap sx={{ fontWeight: 500, minWidth: 0 }}>
      Interviews
    </Typography>
    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0 }}>
      {dictionary.catalog.folderCounts(3, 12)}
    </Typography>
  </ListItemButton>
);

const VideoRowSpecimen = ({ duplicate }: { duplicate: boolean }) => (
  <ListItemButton sx={{ alignItems: 'center', gap: 1.25, borderRadius: 1, py: 1, px: 1 }}>
    <MediaThumbnail path={null} mtime={null} alt="row" width={56} square source={{ width: 1920, height: 1080, rotation: 0 }} />
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
        beach-sunset-final.mp4
      </Typography>
      <Typography variant="caption" component="div" noWrap>
        <span>04:12</span>
        <span> · </span>
        <span>218 MB</span>
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {duplicate ? <DuplicateBadge canonicalPath={CANONICAL} /> : <VideoStatusBadge status="pending" variant="list" />}
      </Box>
    </Box>
  </ListItemButton>
);

const rowSpecimens: readonly Specimen[] = [
  { id: 'row-folder', label: 'Tree folder row', node: <FolderRowSpecimen /> },
  { id: 'row-video', label: 'Video row', node: <VideoRowSpecimen duplicate={false} /> },
  { id: 'row-video-duplicate', label: 'Video row (duplicate)', node: <VideoRowSpecimen duplicate /> },
];

const ModelRowSpecimen = ({ model }: { model: WhisperModelEntry }) => (
  <Box sx={{ width: 460 }}>
    <WhisperModelRow
      model={model}
      activating={false}
      deleting={false}
      downloadPercentage={null}
      disabled={false}
      onActivate={() => undefined}
      onDownload={() => undefined}
      onDelete={() => undefined}
    />
  </Box>
);

const modelSpecimens: readonly Specimen[] = [
  {
    id: 'model-row-active',
    label: 'Model row (active)',
    node: <ModelRowSpecimen model={{ name: 'base', size: '142 MB', downloaded: true, active: true }} />,
  },
  {
    id: 'model-row-downloaded',
    label: 'Model row (downloaded)',
    node: <ModelRowSpecimen model={{ name: 'small', size: '466 MB', downloaded: true, active: false }} />,
  },
  {
    id: 'model-row-missing',
    label: 'Model row (not downloaded)',
    node: <ModelRowSpecimen model={{ name: 'medium', size: '1.5 GB', downloaded: false, active: false }} />,
  },
];

const controlSpecimens: readonly Specimen[] = [
  {
    id: 'buttons',
    label: 'Buttons',
    node: (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <Button variant="contained" size="small" startIcon={<PlayCircleIcon fontSize="small" />}>
          Analyze
        </Button>
        <Button variant="outlined" size="small">
          Analyze anyway
        </Button>
        <Button variant="text" size="small" color="inherit">
          Hide
        </Button>
      </Box>
    ),
  },
  {
    id: 'callout',
    label: 'Callout',
    node: (
      <Alert severity="warning" icon={false} sx={{ maxWidth: 320 }}>
        <Typography variant="h2">Processing incomplete</Typography>
        <Typography variant="body2">Some steps did not finish.</Typography>
      </Alert>
    ),
  },
];

const sections: readonly { title: string; specimens: readonly Specimen[] }[] = [
  { title: 'Status badges', specimens: badgeSpecimens },
  { title: 'Tag chips', specimens: tagSpecimens },
  { title: 'Thumbnails', specimens: thumbnailSpecimens },
  { title: 'Rows', specimens: rowSpecimens },
  { title: 'Model manager rows', specimens: modelSpecimens },
  { title: 'Controls', specimens: controlSpecimens },
];

const SpecimenCell = ({ mode, specimen }: { mode: ThemeMode; specimen: Specimen }) => (
  <Box
    data-testid={`spec-${mode}-${specimen.id}`}
    sx={{
      display: 'flex',
      flexDirection: 'column',
      gap: 0.75,
      p: 1.5,
      borderRadius: 2,
      border: 1,
      borderColor: 'divider',
      bgcolor: 'background.paper',
    }}
  >
    <Typography variant="caption" color="text.secondary">
      {specimen.label}
    </Typography>
    <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 40 }}>{specimen.node}</Box>
  </Box>
);

const ThemePanel = ({ mode }: { mode: ThemeMode }) => (
  <ThemeProvider theme={createAppTheme(mode)}>
    <Box
      data-testid={`gallery-panel-${mode}`}
      sx={{ flex: 1, minWidth: 440, bgcolor: 'background.default', color: 'text.primary', p: 3 }}
    >
      <Typography variant="h1" sx={{ mb: 2, textTransform: 'capitalize' }}>
        {mode}
      </Typography>
      {sections.map((section) => (
        <Box key={section.title} sx={{ mb: 3 }}>
          <Typography variant="h2" sx={{ mb: 1 }}>
            {section.title}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {section.specimens.map((specimen) => (
              <SpecimenCell key={specimen.id} mode={mode} specimen={specimen} />
            ))}
          </Box>
        </Box>
      ))}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2" sx={{ mb: 1 }}>
          Compare view skeleton
        </Typography>
        <CompareSpecimen />
      </Box>
    </Box>
  </ThemeProvider>
);

export const GalleryApp = () => (
  <>
    <CssBaseline />
    <Box sx={{ display: 'flex', alignItems: 'stretch', minHeight: '100vh' }}>
      <ThemePanel mode="light" />
      <ThemePanel mode="dark" />
    </Box>
  </>
);
