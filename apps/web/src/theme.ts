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

declare module '@mui/material/styles' {
  interface Palette {
    status: StatusPalette;
  }
  interface PaletteOptions {
    status?: StatusPalette;
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
    notTracked: { main: '#86868b', soft: '#ededed', contrastText: '#1d1d1f' },
  } satisfies StatusPalette,
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
    notTracked: { main: '#98989d', soft: 'rgba(152, 152, 157, 0.16)', contrastText: '#1c1c1e' },
  } satisfies StatusPalette,
};

const RADIUS = 8;
const CHIP_ICON_INSET = 8;
const CHIP_ICON_GAP = -4;
const chipIconSpacing = { marginLeft: CHIP_ICON_INSET, marginRight: CHIP_ICON_GAP } as const;

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
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS - 2,
            fontWeight: 600,
            fontSize: '0.72rem',
            '& .MuiChip-icon': chipIconSpacing,
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
