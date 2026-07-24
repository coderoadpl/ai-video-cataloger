import { ThemeProvider } from '@mui/material/styles';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { createAppTheme } from '../../theme.js';
import { MediaThumbnail } from './MediaThumbnail.js';

const theme = createAppTheme('light');

describe('MediaThumbnail square geometry', () => {
  it('renders a fixed square bounding box in square mode', () => {
    renderWithProviders(
      <ThemeProvider theme={theme}>
        <MediaThumbnail
          path="/videos/clip.mp4/thumb.jpg"
          mtime={1}
          alt="clip"
          width={56}
          square
          source={{ width: 1920, height: 1080, rotation: 0 }}
        />
      </ThemeProvider>,
    );
    const box = screen.getByTestId('media-thumbnail');
    expect(box.getAttribute('data-thumbnail-width')).toBe('56');
    expect(box.getAttribute('data-thumbnail-height')).toBe('56');
    const img = screen.getByTestId('media-thumbnail-img');
    expect(getComputedStyle(img).objectFit).toBe('contain');
  });

  it('shows the placeholder icon in the same square box when no thumbnail exists', () => {
    renderWithProviders(
      <ThemeProvider theme={theme}>
        <MediaThumbnail path={null} mtime={null} alt="clip" width={56} square />
      </ThemeProvider>,
    );
    const box = screen.getByTestId('media-thumbnail');
    expect(box.getAttribute('data-thumbnail-width')).toBe('56');
    expect(box.getAttribute('data-thumbnail-height')).toBe('56');
    expect(screen.queryByTestId('media-thumbnail-img')).toBeNull();
  });
});
