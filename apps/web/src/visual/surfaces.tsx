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
import { getDict } from '../i18n/dictionary.js';

const SURFACE_IDS = [
  'shell-default',
  'shell-sidebar-collapsed',
  'shell-terminal-open',
  'shell-loading',
] as const;

export type SurfaceId = (typeof SURFACE_IDS)[number];

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
  { id: 'visual-1', content: '$ ai-video-cataloger scan /Volumes/Media/Clips', type: 'info', isJson: false },
  { id: 'visual-2', content: 'scanned 3 files, 1 pending', type: 'stdout', isJson: false },
  { id: 'visual-3', content: 'analyze beach-sunset-final.mp4 — done', type: 'success', isJson: false },
  { id: 'visual-4', content: 'ffprobe: drone-pass-north.mp4 is unreadable', type: 'error', isJson: false },
];

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

const surfaceFor = (id: SurfaceId): Surface => {
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
