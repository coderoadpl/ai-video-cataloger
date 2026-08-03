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
import { CatalogSidebar } from '../features/catalog/CatalogSidebar.js';
import { SidebarSkeleton } from '../features/catalog/SidebarSkeleton.js';
import { type CatalogState } from '../features/catalog/use-catalog.js';
import { DetailsSkeleton } from '../features/details/DetailsSkeleton.js';
import { type DetailsVideo } from '../features/details/details-video.js';
import {
  VariantCompareView,
  type VariantCompareVariant,
} from '../features/details/VariantCompareView.js';
import { PhotosSidebar } from '../features/photos/PhotosSidebar.js';
import { type PhotosAnalysisState } from '../features/photos/use-photos-analysis.js';
import { getDict } from '../i18n/dictionary.js';
import { PhotosLayout } from '../components/layout/PhotosLayout.js';

interface PhotosFixtureItem {
  fingerprint: string;
  fileName: string;
}

const SURFACE_IDS = [
  'shell-default',
  'shell-sidebar-collapsed',
  'shell-terminal-open',
  'shell-loading',
  'variant-compare',
  'photos-layout',
  'catalog-sidebar-narrow',
  'catalog-sidebar-wide',
  'photos-sidebar-narrow',
  'photos-sidebar-wide',
] as const;

export type SurfaceId = (typeof SURFACE_IDS)[number];
type StandaloneSurfaceId =
  | 'variant-compare'
  | 'photos-layout'
  | 'catalog-sidebar-narrow'
  | 'catalog-sidebar-wide'
  | 'photos-sidebar-narrow'
  | 'photos-sidebar-wide';
type ShellSurfaceId = Exclude<SurfaceId, StandaloneSurfaceId>;

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

const SIDEBAR_NARROW_WIDTH = 260;
const SIDEBAR_WIDE_WIDTH = SIDEBAR_DEFAULT_SIZE;

type CatalogVideo = CatalogState['videos'][number];
type PhotoListItem = PhotosAnalysisState['items'][number];

const emptyVideoArtifacts: CatalogVideo['artifacts'] = {
  framePaths: null,
  transcriptContent: null,
  transcriptPath: null,
  summary: null,
  summaryPath: null,
  thumbnailPath: null,
  thumbnailMtime: null,
  newFilename: null,
};

const SIDEBAR_VIDEOS: readonly CatalogVideo[] = [
  {
    path: '/Volumes/Media/Clips/beach-sunset-final.mp4',
    filename: 'beach-sunset-final.mp4',
    size: 218_000_000,
    sizeFormatted: '218 MB',
    duration: 252,
    durationFormatted: '04:12',
    status: 'completed',
    errorMessage: null,
    contentHash: 'fixture-hash-1',
    artifacts: emptyVideoArtifacts,
  },
  {
    path: '/Volumes/Media/Clips/interview-take-two.mov',
    filename: 'interview-take-two.mov',
    size: 1_400_000_000,
    sizeFormatted: '1.4 GB',
    duration: 768,
    durationFormatted: '12:48',
    status: 'pending',
    errorMessage: null,
    contentHash: 'fixture-hash-2',
    artifacts: emptyVideoArtifacts,
  },
  {
    path: '/Volumes/Media/Clips/drone-pass-north.mp4',
    filename: 'drone-pass-north.mp4',
    size: 96_000_000,
    sizeFormatted: '96 MB',
    duration: 96,
    durationFormatted: '01:36',
    status: 'error',
    errorMessage: 'ffprobe: unreadable container',
    contentHash: null,
    artifacts: emptyVideoArtifacts,
  },
];

const SIDEBAR_RECENT_FOLDERS: readonly string[] = [
  '/Volumes/Media/Clips',
  '/Volumes/Media/Archive/2026-Q1',
];

const CATALOG_SIDEBAR_STATE: CatalogState = {
  videos: SIDEBAR_VIDEOS,
  selectedVideo: SIDEBAR_VIDEOS[0] ?? null,
  selectedKey: SIDEBAR_VIDEOS[0]?.path ?? null,
  select: noop,
  selectKey: noop,
  isLoading: false,
  isError: false,
  error: null,
  isGeneratingThumbnails: false,
  thumbnailFailedPaths: new Set(SIDEBAR_VIDEOS.map((video) => video.path)),
};

const photoItem = (overrides: Partial<PhotoListItem> & { fingerprint: string }): PhotoListItem => ({
  fileName: `${overrides.fingerprint}.jpg`,
  currentPath: `/Volumes/Media/Photos/${overrides.fingerprint}.jpg`,
  ext: 'jpg',
  capturedAt: '2026-06-14T09:30:00.000Z',
  capturedAtSource: 'exif_offset',
  width: 4000,
  height: 3000,
  proxyState: 'done',
  thumbState: 'done',
  missingAt: null,
  sightings: 1,
  thumbPath: null,
  gridThumbPath: null,
  proxyPath: null,
  analysed: false,
  exifReadAt: '2026-06-14T09:31:00.000Z',
  ...overrides,
});

const PHOTOS_SIDEBAR_ITEMS: readonly PhotoListItem[] = [
  photoItem({ fingerprint: 'ph_0000000000000001', fileName: 'coastal-market-01.jpg', analysed: true }),
  photoItem({ fingerprint: 'ph_0000000000000002', fileName: 'coastal-market-02.jpg', sightings: 2 }),
  photoItem({ fingerprint: 'ph_0000000000000003', fileName: 'coastal-market-03.jpg', proxyState: 'failed' }),
  photoItem({ fingerprint: 'ph_0000000000000004', fileName: 'coastal-market-04.jpg', exifReadAt: null }),
];

const PHOTOS_SIDEBAR_STATE: PhotosAnalysisState = {
  isLoading: false,
  error: null,
  roots: [
    { root: '/Volumes/Media/Photos', photos: PHOTOS_SIDEBAR_ITEMS.length, missing: 0, lastScanAt: '2026-06-14T09:31:00.000Z' },
  ],
  scope: 'folder',
  setScope: noop,
  folder: '/Volumes/Media/Photos',
  folderState: 'scanned',
  selectedRoot: '/Volumes/Media/Photos',
  items: [...PHOTOS_SIDEBAR_ITEMS],
  total: PHOTOS_SIDEBAR_ITEMS.length,
  hasMore: false,
  isLoadingMore: false,
  loadMore: noop,
  counts: { photos: PHOTOS_SIDEBAR_ITEMS.length, paths: PHOTOS_SIDEBAR_ITEMS.length, proxied: 3, proxyFailed: 1 },
  selectedFingerprint: PHOTOS_SIDEBAR_ITEMS[0]?.fingerprint ?? null,
  selectFingerprint: noop,
  activeJobLabel: null,
  analyzeStatusLabel: null,
  isBusy: false,
  scanFolder: noop,
  detail: null,
  isDetailLoading: false,
  variants: [],
  selectVariant: noop,
  analyzePhotos: noop,
  canAnalyze: true,
  analyzeProgress: null,
  processingFingerprints: new Set(),
  generateProxies: noop,
  isCancellable: false,
  cancelConfirmation: { open: false, isBatch: false },
  requestCancelAnalysis: noop,
  confirmCancelAnalysis: noop,
  closeCancelConfirmation: noop,
};

const SidebarPanelFrame = ({ width, children }: { width: number; children: ReactNode }) => (
  <Box
    sx={{
      width,
      height: 640,
      display: 'flex',
      flexDirection: 'column',
      bgcolor: 'background.paper',
      borderRight: 1,
      borderColor: 'divider',
      overflow: 'hidden',
    }}
  >
    {children}
  </Box>
);

const CatalogSidebarFixture = ({ width }: { width: number }) => (
  <SidebarPanelFrame width={width}>
    <CatalogSidebar
      folder="/Volumes/Media/Clips"
      catalog={CATALOG_SIDEBAR_STATE}
      showTree={false}
      registerVideos={noop}
      recentFolders={[...SIDEBAR_RECENT_FOLDERS]}
      isCheckingFolder={false}
      onOpenFolder={noop}
      onSelectRecentFolder={noop}
      onClearRecentFolders={noop}
    />
  </SidebarPanelFrame>
);

const PhotosSidebarFixture = ({ width }: { width: number }) => (
  <SidebarPanelFrame width={width}>
    <PhotosSidebar
      state={PHOTOS_SIDEBAR_STATE}
      onOpenFolder={noop}
      recentFolders={[...SIDEBAR_RECENT_FOLDERS]}
      isCheckingFolder={false}
      onSelectRecentFolder={noop}
      onClearRecentFolders={noop}
    />
  </SidebarPanelFrame>
);

const Header = () => (
  <AppHeader
    appVersion="0.5.13"
    onShowSettings={noop}
    onShowModelManager={noop}
    onShowPrerequisites={noop}
    mode="analysis"
    onModeChange={noop}
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

const PHOTOS_FIXTURE_ITEMS: readonly PhotosFixtureItem[] = [
  { fingerprint: 'ph_0000000000000001', fileName: 'coastal-market.jpg' },
];

const PhotosFixture = () => (
  <PhotosLayout
    heading={
      <Box>
        <Typography variant="h1">{dictionary.photos.title}</Typography>
        <Typography variant="caption">{dictionary.photos.subtitle}</Typography>
      </Box>
    }
    toolbar={<Button variant="outlined" size="small">{dictionary.photos.scanFolderAction}</Button>}
    grid={
      <Box sx={{ display: 'flex', gap: 1 }}>
        {PHOTOS_FIXTURE_ITEMS.map((item) => (
          <Box
            key={item.fingerprint}
            sx={{ width: 168, height: 168, bgcolor: 'background.default', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Typography variant="caption">{item.fileName}</Typography>
          </Box>
        ))}
      </Box>
    }
    detail={<Typography variant="body2">{dictionary.photos.detailDimensions}: 4000×3000</Typography>}
  />
);

export const VisualSurface = ({ id }: { id: SurfaceId }) => {
  if (id === 'variant-compare') {
    return (
      <Box data-testid="visual-surface-variant-compare" sx={{ minHeight: '100vh' }}>
        <VariantCompareFixture />
      </Box>
    );
  }
  if (id === 'photos-layout') {
    return (
      <Box data-testid="visual-surface-photos-layout" sx={{ minHeight: '100vh' }}>
        <PhotosFixture />
      </Box>
    );
  }
  if (id === 'catalog-sidebar-narrow' || id === 'catalog-sidebar-wide') {
    return (
      <Box data-testid={`visual-surface-${id}`} sx={{ minHeight: '100vh', p: 2 }}>
        <CatalogSidebarFixture width={id === 'catalog-sidebar-narrow' ? SIDEBAR_NARROW_WIDTH : SIDEBAR_WIDE_WIDTH} />
      </Box>
    );
  }
  if (id === 'photos-sidebar-narrow' || id === 'photos-sidebar-wide') {
    return (
      <Box data-testid={`visual-surface-${id}`} sx={{ minHeight: '100vh', p: 2 }}>
        <PhotosSidebarFixture width={id === 'photos-sidebar-narrow' ? SIDEBAR_NARROW_WIDTH : SIDEBAR_WIDE_WIDTH} />
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
