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

import { FolderIcon, PlayCircleIcon } from '../components/ui/icons.js';
import { MediaThumbnail } from '../components/ui/MediaThumbnail.js';
import { VideoStatusBadge } from '../components/ui/VideoStatusBadge.js';
import { DuplicateBadge } from '../features/catalog/DuplicateBadge.js';
import { SkippedBadge } from '../features/catalog/VideoList.js';
import { getDict } from '../i18n/dictionary.js';
import { createAppTheme, type ThemeMode } from '../theme.js';

const dictionary = getDict('en');

interface Specimen {
  id: string;
  label: string;
  node: ReactNode;
}

const CANONICAL = '/Volumes/Media/Clips/original-take.mp4';

const badgeSpecimens: readonly Specimen[] = [
  { id: 'badge-pending', label: 'Pending', node: <VideoStatusBadge status="pending" variant="details" /> },
  { id: 'badge-completed', label: 'Completed', node: <VideoStatusBadge status="completed" variant="details" /> },
  { id: 'badge-in-progress', label: 'In progress', node: <VideoStatusBadge status="analyzed" variant="details" /> },
  { id: 'badge-processing', label: 'Processing', node: <VideoStatusBadge status="pending" analyzing variant="details" /> },
  { id: 'badge-error', label: 'Error / missing', node: <VideoStatusBadge status="error" variant="details" /> },
  { id: 'badge-not-tracked', label: 'Not Tracked', node: <VideoStatusBadge status="not_tracked" variant="details" /> },
  { id: 'badge-duplicate', label: 'Duplicate', node: <DuplicateBadge canonicalPath={CANONICAL} /> },
  { id: 'badge-skipped', label: 'Skipped', node: <SkippedBadge dictionary={dictionary} /> },
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
