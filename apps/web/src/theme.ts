import { createTheme, type Theme } from '@mui/material/styles';


export type ThemeMode = 'light' | 'dark';

export const STATUS_TOKENS = [
  'pending',
  'inProgress',
  'completed',
  'error',
  'notTracked',
] as const;

export type StatusToken = (typeof STATUS_TOKENS)[number];

export interface StatusColor {
  main: string;
  soft: string;
  contrastText: string;
}

export type StatusPalette = Record<StatusToken, StatusColor>;

export interface MapPalette {
  canvas: string;
  land: string;
  landBorder: string;
  graticule: string;
  pin: string;
  pinMuted: string;
  pinApproximate: string;
  pinApproximateHalo: string;
  pinPhoto: string;
  pinPhotoHalo: string;
  cluster: string;
  clusterText: string;
}

export interface LibraryPalette {
  selectionOutline: string;
  selectionOverlay: string;
  actionBarBackground: string;
}

export interface PeoplePalette {
  otherTileBackground: string;
  otherTileHoverBackground: string;
  otherTileBorder: string;
  otherTileText: string;
}

declare module '@mui/material/styles' {
  interface Palette {
    status: StatusPalette;
    map: MapPalette;
    library: LibraryPalette;
    people: PeoplePalette;
  }
  interface PaletteOptions {
    status?: StatusPalette;
    map?: MapPalette;
    library?: LibraryPalette;
    people?: PeoplePalette;
  }
}

const FONT_SANS =
  "'SF Pro Text', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
const FONT_MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace";

const ACCENT = '#007AFF';

const LIGHT = {
  background: '#f5f5f7',
  paper: '#ffffff',
  raised: '#ffffff',
  ink: '#1d1d1f',
  inkSoft: '#86868b',
  border: '#d2d2d7',
  destructive: '#ff3b30',
  status: {
    pending: { main: '#b45309', soft: '#fef3c7', contrastText: '#1d1d1f' },
    inProgress: { main: '#1d4ed8', soft: '#dbeafe', contrastText: '#1d1d1f' },
    completed: { main: '#15803d', soft: '#dcfce7', contrastText: '#1d1d1f' },
    error: { main: '#b91c1c', soft: '#fee2e2', contrastText: '#1d1d1f' },
    notTracked: { main: '#4e4e53', soft: '#e3e3e6', contrastText: '#1d1d1f' },
  } satisfies StatusPalette,
  map: {
    canvas: '#eef2f6',
    land: '#dfe5ea',
    landBorder: '#c3ccd4',
    graticule: '#e3e8ec',
    pin: '#007AFF',
    pinMuted: '#a1a1a6',
    pinApproximate: '#f59e0b',
    pinApproximateHalo: 'rgba(245,158,11,0.18)',
    pinPhoto: '#af52de',
    pinPhotoHalo: 'rgba(175,82,222,0.18)',
    cluster: '#007AFF',
    clusterText: '#ffffff',
  } satisfies MapPalette,
  library: {
    selectionOutline: '#007AFF',
    selectionOverlay: 'rgba(0, 122, 255, 0.18)',
    actionBarBackground: '#ffffff',
  } satisfies LibraryPalette,
  people: {
    otherTileBackground: '#f0f7f4',
    otherTileHoverBackground: '#e5f0eb',
    otherTileBorder: '#7aa492',
    otherTileText: '#2f5d4a',
  } satisfies PeoplePalette,
};

const DARK = {
  background: '#1c1c1e',
  paper: '#2c2c2e',
  raised: '#3a3a3c',
  ink: '#f5f5f7',
  inkSoft: '#98989d',
  border: '#3a3a3c',
  destructive: '#ff453a',
  status: {
    pending: { main: '#fbbf24', soft: 'rgba(251, 191, 36, 0.16)', contrastText: '#1c1c1e' },
    inProgress: { main: '#60a5fa', soft: 'rgba(96, 165, 250, 0.16)', contrastText: '#1c1c1e' },
    completed: { main: '#4ade80', soft: 'rgba(74, 222, 128, 0.16)', contrastText: '#1c1c1e' },
    error: { main: '#f87171', soft: 'rgba(248, 113, 113, 0.16)', contrastText: '#1c1c1e' },
    notTracked: { main: '#c7c7cc', soft: 'rgba(199, 199, 204, 0.20)', contrastText: '#1c1c1e' },
  } satisfies StatusPalette,
  map: {
    canvas: '#242426',
    land: '#3a3a3c',
    landBorder: '#4a4a4d',
    graticule: '#2f2f31',
    pin: '#0a84ff',
    pinMuted: '#6e6e73',
    pinApproximate: '#fbbf24',
    pinApproximateHalo: 'rgba(251,191,36,0.22)',
    pinPhoto: '#bf5af2',
    pinPhotoHalo: 'rgba(191,90,242,0.22)',
    cluster: '#0a84ff',
    clusterText: '#0b0b0c',
  } satisfies MapPalette,
  library: {
    selectionOutline: '#0a84ff',
    selectionOverlay: 'rgba(10, 132, 255, 0.24)',
    actionBarBackground: '#2c2c2e',
  } satisfies LibraryPalette,
  people: {
    otherTileBackground: '#25342f',
    otherTileHoverBackground: '#2f423b',
    otherTileBorder: '#6fa18e',
    otherTileText: '#b7dbc9',
  } satisfies PeoplePalette,
};

const PLACEHOLDER_HUE_BASE = 210;
const PLACEHOLDER_HUE_STEP = 12;
const placeholderHue = (index: number): number => PLACEHOLDER_HUE_BASE + index * PLACEHOLDER_HUE_STEP;
const placeholderDuotone = (hue: number, from: [number, number], to: [number, number]): string =>
  `linear-gradient(135deg, hsl(${String(hue)} ${String(from[0])}% ${String(from[1])}%), hsl(${String(hue)} ${String(to[0])}% ${String(to[1])}%))`;

export const placeholderGradients = {
  light: Array.from({ length: 6 }, (_, index) => placeholderDuotone(placeholderHue(index), [24, 93], [20, 85])),
  dark: Array.from({ length: 6 }, (_, index) => placeholderDuotone(placeholderHue(index), [18, 32], [13, 21])),
} as const;

const RADIUS = 8;
const CHIP_ICON_INSET = 8;
const CHIP_ICON_GAP = -4;
export const CHIP_ICON_SPACING = { marginLeft: CHIP_ICON_INSET, marginRight: CHIP_ICON_GAP } as const;

export const createAppTheme = (mode: ThemeMode): Theme => {
  const c = mode === 'dark' ? DARK : LIGHT;

  return createTheme({
    palette: {
      mode,
      primary: { main: ACCENT, contrastText: '#ffffff' },
      error: { main: c.destructive },
      background: { default: c.background, paper: c.paper },
      text: { primary: c.ink, secondary: c.inkSoft },
      divider: c.border,
      status: c.status,
      map: c.map,
      library: c.library,
      people: c.people,
    },
    shape: { borderRadius: RADIUS },
    typography: {
      fontFamily: FONT_SANS,
      h1: { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.01em' },
      h2: { fontSize: '0.95rem', fontWeight: 600 },
      body2: { fontSize: '0.8125rem' },
      caption: { fontSize: '0.75rem', color: c.inkSoft },
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          code: { fontFamily: FONT_MONO },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: RADIUS - 2 },
        },
        variants: [
          {
            props: { variant: 'outlined', color: 'primary' },
            style: {
              borderColor: c.border,
              color: c.ink,
              '&:hover': {
                borderColor: c.border,
                backgroundColor: mode === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)',
              },
            },
          },
        ],
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS - 2,
            fontWeight: 600,
            fontSize: '0.72rem',
            '& .MuiChip-icon': CHIP_ICON_SPACING,
          },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            border: `1px solid ${c.border}`,
            boxShadow: mode === 'dark'
              ? '0 14px 36px rgba(0, 0, 0, 0.36)'
              : '0 14px 36px rgba(29, 29, 31, 0.14)',
          },
          groupLabel: {
            fontSize: '0.72rem',
            fontWeight: 700,
            color: c.inkSoft,
            lineHeight: 1.8,
          },
          option: {
            gap: 8,
            minHeight: 34,
            fontSize: '0.8125rem',
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
    },
  });
};
