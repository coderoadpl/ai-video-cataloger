import { describe, expect, it } from 'vitest';

import { createAppTheme } from './theme.js';

describe('chip icon spacing', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`insets the icon from the left edge for small and medium chips in ${mode} mode`, () => {
      const root = createAppTheme(mode).components?.MuiChip?.styleOverrides?.root;
      expect(root).toMatchObject({ '& .MuiChip-icon': { marginLeft: 8, marginRight: -4 } });
    });
  }
});
