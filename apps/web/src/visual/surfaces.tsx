import { type ReactNode } from 'react';
import { Alert, Box, Button, Chip, ListItemButton, Typography } from '@mui/material';

import {
  AppShell,
  SIDEBAR_DEFAULT_SIZE,
  TERMINAL_DEFAULT_SIZE,
} from '../components/layout/AppShell.js';
import { AppHeader } from '../components/ui/AppHeader.js';
import { FolderIcon } from '../components/ui/icons.js';
import { TerminalLog } from '../components/ui/TerminalLog.js';
import type { LogLine } from '../components/ui/use-terminal-log.js';
import { VideoStatusBadge } from '../components/ui/VideoStatusBadge.js';
import { SidebarSkeleton } from '../features/catalog/SidebarSkeleton.js';
import { DetailsSkeleton } from '../features/details/DetailsSkeleton.js';
import { type DetailsVideo } from '../features/details/details-video.js';
import {
  VariantCompareView,
  type VariantCompareVariant,
} from '../features/details/VariantCompareView.js';
import { getDict } from '../i18n/dictionary.js';

const SURFACE_IDS = [
  'shell-default',
  'shell-sidebar-collapsed',
  'shell-terminal-open',
  'shell-loading',
  'variant-compare',
] as const;

export type SurfaceId = (typeof SURFACE_IDS)[number];
type ShellSurfaceId = Exclude<SurfaceId, 'variant-compare'>;

const DEFAULT_SURFACE: SurfaceId = 'shell-default';

const isSurfaceId = (value: string | null): value is SurfaceId =>
  SURFACE_IDS.some((id) => id === value);

export const surfaceIdFromSearch = (search: string): SurfaceId => {
  const requested = new URLSearchParams(search).get('surface');
  return isSurfaceId(requested) ? requested : DEFAULT_SURFACE;
};

const dictionary = getDict('en');

const noop = (): void => undefined;

const FOLDER = '/Volumes/Media/Clips';

const CATALOG_ROWS: readonly { name: string; meta: string; status: 'completed' | 'pending' | 'error' }[] =
  [
    { name: 'beach-sunset-final.mp4', meta: '04:12 · 218 MB', status: 'completed' },
    { name: 'interview-take-two.mov', meta: '12:48 · 1.4 GB', status: 'pending' },
    { name: 'drone-pass-north.mp4', meta: '01:36 · 96 MB', status: 'error' },
  ];

const LOG_LINES: readonly LogLine[] = [
  { id: 'visual-1', at: 1, content: '$ ai-video-cataloger scan /Volumes/Media/Clips', type: 'info', raw: null },
  { id: 'visual-2', at: 2, content: 'scanned 3 files, 1 pending', type: 'stdout', raw: null },
  { id: 'visual-3', at: 3, content: 'analyze beach-sunset-final.mp4 — done', type: 'success', raw: null },
  { id: 'visual-4', at: 4, content: 'ffprobe: drone-pass-north.mp4 is unreadable', type: 'error', raw: null },
];

const COMPARE_VIDEO: DetailsVideo = {
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
    transcriptContent: 'A vendor describes the market as customers pass the camera.',
    transcriptPath: '/fixture/first/transcript.txt',
    summary: null,
    summaryPath: '/fixture/first/summary.txt',
    thumbnailPath: null,
    thumbnailMtime: null,
    newFilename: 'coastal-market-morning.mp4',
  },
};

const COMPARE_VARIANTS: readonly VariantCompareVariant[] = [
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
    transcript: 'A vendor describes the market as customers pass the camera.',
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
    description: 'A lively walk through a coastal market, focused on vendors and local produce.',
    transcript: 'The narrator introduces the market while the camera moves between stalls.',
    language: 'pl',
    tags: ['market', 'vendors', 'produce'],
  },
];

const fixtureFrameUrl = (path: string): string =>
  path.endsWith('frame-002.jpg') ? '/compare-frame-2.svg' : '/compare-frame-1.svg';

const VariantCompareFixture = () => (
  <VariantCompareView
    video={COMPARE_VIDEO}
    variants={COMPARE_VARIANTS}
    selectingConfigId={null}
    actionError={null}
    onBack={noop}
    onSelect={noop}
    frameUrl={fixtureFrameUrl}
    dictionary={dictionary}
  />
);

const Header = () => (
  <AppHeader
    appVersion="0.5.13"
    recentFolders={[FOLDER]}
    isCheckingFolder={false}
    onOpenFolder={noop}
    onSelectRecentFolder={noop}
    onShowSettings={noop}
    onShowModelManager={noop}
    onShowPrerequisites={noop}
    searchQuery=""
    onSearchQueryChange={noop}
    onSearchSubmit={noop}
    recentSearches={[]}
    onRemoveRecentSearch={noop}
    topTags={[]}
    onSearchFocus={noop}
  />
);

const CatalogFixture = () => (
  <Box sx={{ p: 1 }}>
    <ListItemButton sx={{ gap: 0.75, py: 0.5, px: 1, borderRadius: 1 }}>
      <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />
      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
        Clips
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
        {dictionary.catalog.folderCounts(1, 3)}
      </Typography>
    </ListItemButton>
    {CATALOG_ROWS.map((row) => (
      <ListItemButton key={row.name} sx={{ alignItems: 'center', gap: 1.25, borderRadius: 1, py: 1, px: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
            {row.name}
          </Typography>
          <Typography variant="caption" noWrap>
            {row.meta}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <VideoStatusBadge status={row.status} variant="list" />
          </Box>
        </Box>
      </ListItemButton>
    ))}
  </Box>
);

const DetailsFixture = () => (
  <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
    <Typography variant="h1">beach-sunset-final.mp4</Typography>
    <Typography variant="body2" color="text.secondary">
      {FOLDER}
    </Typography>
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {['interview', 'b-roll', 'outdoor', 'sunset'].map((tag) => (
        <Chip key={tag} label={tag} size="small" />
      ))}
    </Box>
    <Typography variant="body2">
      A wide handheld shot of a beach at golden hour, ending on a slow pan to the pier.
    </Typography>
  </Box>
);

const BannerFixture = () => (
  <Alert severity="warning" sx={{ m: 2 }}>
    <Typography variant="h2">Setup incomplete</Typography>
    <Typography variant="body2">Missing: ffmpeg, whisper runtime.</Typography>
  </Alert>
);

interface Surface {
  sidebar: ReactNode;
  content: ReactNode;
  banner?: ReactNode;
  sidebarCollapsed: boolean;
  terminalCollapsed: boolean;
}

const surfaceFor = (id: ShellSurfaceId): Surface => {
  switch (id) {
    case 'shell-default':
      return {
        sidebar: <CatalogFixture />,
        content: <DetailsFixture />,
        sidebarCollapsed: false,
        terminalCollapsed: true,
      };
    case 'shell-sidebar-collapsed':
      return {
        sidebar: <CatalogFixture />,
        content: <DetailsFixture />,
        sidebarCollapsed: true,
        terminalCollapsed: true,
      };
    case 'shell-terminal-open':
      return {
        sidebar: <CatalogFixture />,
        content: <DetailsFixture />,
        sidebarCollapsed: false,
        terminalCollapsed: false,
      };
    case 'shell-loading':
      return {
        sidebar: <SidebarSkeleton />,
        content: <DetailsSkeleton />,
        banner: <BannerFixture />,
        sidebarCollapsed: false,
        terminalCollapsed: true,
      };
  }
};

export const VisualSurface = ({ id }: { id: SurfaceId }) => {
  if (id === 'variant-compare') {
    return (
      <Box data-testid="visual-surface-variant-compare" sx={{ minHeight: '100vh' }}>
        <VariantCompareFixture />
      </Box>
    );
  }
  const surface = surfaceFor(id);

  return (
    <Box data-testid={`visual-surface-${id}`}>
      <AppShell
        header={<Header />}
        sidebarHeading={<Typography variant="h2">{dictionary.appFrame.sidebarHeading}</Typography>}
        sidebarAction={
          <Button size="small" color="inherit">
            {dictionary.appFrame.hideSidebar}
          </Button>
        }
        sidebarExpandAction={
          <Button size="small" color="inherit">
            {dictionary.appFrame.showSidebar}
          </Button>
        }
        sidebar={surface.sidebar}
        sidebarCollapsed={surface.sidebarCollapsed}
        sidebarWidth={SIDEBAR_DEFAULT_SIZE}
        onSidebarResize={noop}
        banner={surface.banner}
        content={surface.content}
        terminalTitle={
          <Typography variant="caption" sx={{ color: 'grey.300' }}>
            {dictionary.appFrame.terminalTitle}
          </Typography>
        }
        terminalActions={
          <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }}>
            {surface.terminalCollapsed
              ? dictionary.appFrame.terminalExpand
              : dictionary.appFrame.terminalCollapse}
          </Button>
        }
        terminal={<TerminalLog lines={LOG_LINES} />}
        terminalCollapsed={surface.terminalCollapsed}
        terminalHeight={TERMINAL_DEFAULT_SIZE}
        onTerminalResize={noop}
      />
    </Box>
  );
};
