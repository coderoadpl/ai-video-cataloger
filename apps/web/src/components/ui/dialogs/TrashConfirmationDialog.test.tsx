import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { configResponse } from '../../../test/config-response.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { TrashConfirmationDialog } from './TrashConfirmationDialog.js';

const writableRoot = {
  folderId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Sample root',
  currentPath: '/fixtures/root',
  fileCount: 2,
  writable: true,
  online: true,
};

describe('TrashConfirmationDialog', () => {
  it('states counts and affected roots', () => {
    server.use(http.get('/api/config', () => HttpResponse.json(configResponse('en'))));
    renderWithProviders(
      <TrashConfirmationDialog
        open
        counts={{ total: 3, videoCount: 2, photoCount: 1 }}
        roots={[writableRoot]}
        loading={false}
        error={null}
        checked={false}
        confirming={false}
        onCheckedChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByTestId('library-trash-count').textContent).toContain('3 files');
    expect(screen.getByTestId('library-trash-root').textContent).toContain('Sample root');
    expect(screen.getByTestId('library-trash-root').textContent).toContain('/fixtures/root');
  });

  it('gates the destructive action behind the checkbox', () => {
    const onConfirm = vi.fn();
    server.use(http.get('/api/config', () => HttpResponse.json(configResponse('en'))));

    renderWithProviders(
      <TrashConfirmationDialog
        open
        counts={{ total: 1, videoCount: 1, photoCount: 0 }}
        roots={[writableRoot]}
        loading={false}
        error={null}
        checked={false}
        confirming={false}
        onCheckedChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId('library-trash-confirm').getAttribute('disabled')).not.toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('replaces the confirm button with a read-only refusal', () => {
    server.use(http.get('/api/config', () => HttpResponse.json(configResponse('en'))));
    renderWithProviders(
      <TrashConfirmationDialog
        open
        counts={{ total: 1, videoCount: 1, photoCount: 0 }}
        roots={[{ ...writableRoot, writable: false }]}
        loading={false}
        error={null}
        checked={false}
        confirming={false}
        onCheckedChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByTestId('library-trash-read-only').textContent).toContain('Sample root');
    expect(screen.queryByTestId('library-trash-confirm')).toBeNull();
  });
});
