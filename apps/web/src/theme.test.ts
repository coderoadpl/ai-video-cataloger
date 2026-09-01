import { describe, expect, it } from 'vitest';

import { CHIP_ICON_SPACING, createAppTheme } from './theme.js';

describe('chip icon spacing', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`insets the icon from the left edge for small and medium chips in ${mode} mode`, () => {
      const root = createAppTheme(mode).components?.MuiChip?.styleOverrides?.root;
      expect(CHIP_ICON_SPACING).toEqual({ marginLeft: 8, marginRight: -4 });
      expect(root).toMatchObject({ '& .MuiChip-icon': CHIP_ICON_SPACING });
    });
  }
});

describe('outlined button neutrality', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`renders a default-color outlined button with the neutral divider border and default text, not primary blue, in ${mode} mode`, () => {
      const theme = createAppTheme(mode);
      const variants = theme.components?.MuiButton?.variants ?? [];
      const neutralOutlined = variants.find((variant) => {
        if (typeof variant.props === 'function') return false;
        return variant.props.variant === 'outlined' && variant.props.color === 'primary';
      });
      expect(neutralOutlined?.style).toMatchObject({
        borderColor: theme.palette.divider,
        color: theme.palette.text.primary,
      });
    });
  }
});
