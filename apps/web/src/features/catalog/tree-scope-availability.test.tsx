import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { ScopeAnalyzeToolbar } from '../../components/ui/ScopeAnalyzeToolbar.js';
import { useTreeScopeAvailability } from './use-tree-absent-files.js';

const theme = createAppTheme('light');

const absentGroups = (entries: number) => ({
  ok: true,
  data: {
    groups: entries === 0
      ? []
      : [
        {
          folderPath: '/drive/sub',
          entries: Array.from({ length: entries }, (_value, index) => ({
            fingerprint: `fp-${String(index)}`,
            fileName: `gone-${String(index)}.mp4`,
            finalName: null,
            missing: true,
            missingAt: 1738368000000,
          })),
        },
      ],
  },
});

const ScopeProbe = ({ subfolderVideoCount }: { subfolderVideoCount: number }) => {
  const available = useTreeScopeAvailability('/drive', subfolderVideoCount);
  return (
    <ScopeAnalyzeToolbar
      scope="folder"
      onScopeChange={vi.fn()}
      pendingCount={0}
      isBusy={false}
      progress={null}
      onAnalyze={vi.fn()}
      onStop={vi.fn()}
      scopeToggleDisabled={!available}
    />
  );
};

const renderProbe = (subfolderVideoCount: number) =>
  renderWithProviders(
    <ThemeProvider theme={theme}>
      <ScopeProbe subfolderVideoCount={subfolderVideoCount} />
    </ThemeProvider>,
  );

describe('whole-tree scope availability', () => {
  it('stays reachable when the tree holds only absent catalog entries', async () => {
    server.use(http.get('/api/catalog-tree/absent', () => HttpResponse.json(absentGroups(2))));

    renderProbe(0);

    await waitFor(() => expect(screen.getByTestId('scope-tree').getAttribute('disabled')).toBeNull());
  });

  it('stays disabled when the tree holds neither present files nor absent entries', async () => {
    server.use(http.get('/api/catalog-tree/absent', () => HttpResponse.json(absentGroups(0))));

    renderProbe(0);

    await waitFor(() => expect(screen.getByTestId('scope-tree').getAttribute('disabled')).not.toBeNull());
  });

  it('never probes the absent endpoint while subfolders still hold videos', async () => {
    let requests = 0;
    server.use(http.get('/api/catalog-tree/absent', () => {
      requests += 1;
      return HttpResponse.json(absentGroups(0));
    }));

    renderProbe(3);

    await waitFor(() => expect(screen.getByTestId('scope-tree').getAttribute('disabled')).toBeNull());
    expect(requests).toBe(0);
  });
});
