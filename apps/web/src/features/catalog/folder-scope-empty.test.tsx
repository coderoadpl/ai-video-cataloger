import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { en } from '../../i18n/dictionary.js';
import { createAppTheme } from '../../theme.js';
import { VideoList } from './VideoList.js';

const theme = createAppTheme('light');

const renderList = (props: {
  subfolderVideoCount?: number;
  onSwitchToWholeTree?: () => void;
}) =>
  renderWithProviders(
    <ThemeProvider theme={theme}>
      <VideoList
        videos={[]}
        selectedKey={null}
        analyzingPath={null}
        isLoading={false}
        isError={false}
        error={null}
        onSelect={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );

describe('folder-scope empty state', () => {
  it('names the videos waiting in subfolders and switches scope on demand', () => {
    const onSwitchToWholeTree = vi.fn();
    renderList({ subfolderVideoCount: 12, onSwitchToWholeTree });

    expect(screen.getByTestId('empty-folder-scope').textContent).toBe(en.catalog.noVideosInFolder(12));

    fireEvent.click(screen.getByTestId('switch-to-tree'));

    expect(onSwitchToWholeTree).toHaveBeenCalledOnce();
  });

  it('keeps the bare message when the whole tree is empty', () => {
    renderList({ subfolderVideoCount: 0, onSwitchToWholeTree: vi.fn() });

    expect(screen.getByText(en.catalog.noVideosFound)).toBeDefined();
    expect(screen.queryByTestId('switch-to-tree')).toBeNull();
  });
});
