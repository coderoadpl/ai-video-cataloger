import { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { createTestQueryClient, renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ReadinessNotice } from './ReadinessNotice.js';
import { useReadiness } from './use-readiness.js';

const readiness = {
  ready: false,
  analyzer: {
    kind: 'analyzer' as const,
    family: 'api' as const,
    providerId: 'openrouter',
    name: 'openrouter',
    available: false,
    message: 'openrouter is unavailable',
    suggestedAction: 'Store a credential. Run: ai-video-cataloger setup',
  },
  transcriber: {
    kind: 'transcriber' as const,
    mode: 'skip' as const,
    model: null,
    name: 'transcription-skip',
    available: true,
    message: 'transcription-skip is available',
    suggestedAction: null,
  },
  missingPieces: [{
    kind: 'analyzer' as const,
    name: 'openrouter',
    available: false,
    message: 'openrouter is unavailable',
    suggestedAction: 'Store a credential. Run: ai-video-cataloger setup',
  }],
  suggestedAction: 'Store a credential. Run: ai-video-cataloger setup',
};

describe('readiness UI', () => {
  it('shows missing setup guidance and both recovery affordances', () => {
    const openSettings = vi.fn();
    const openSetup = vi.fn();
    renderWithProviders(
      <ReadinessNotice readiness={readiness} onOpenSettings={openSettings} onOpenSetup={openSetup} />,
    );

    expect(screen.getByText(/openrouter must be configured/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Setup Wizard' }));
    expect(openSettings).toHaveBeenCalledOnce();
    expect(openSetup).toHaveBeenCalledOnce();
  });

  it('queries on launch and requests an uncached refresh before a run', async () => {
    const requests: string[] = [];
    server.use(http.get('/api/readiness', ({ request }) => {
      requests.push(request.url);
      return HttpResponse.json({ ok: true, data: { ...readiness, ready: true, missingPieces: [], suggestedAction: null } });
    }));
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useReadiness('/videos'), { wrapper });

    await waitFor(() => expect(result.current.data?.ready).toBe(true));
    await expect(result.current.checkNow()).resolves.toBe(true);
    expect(requests.some((url) => url.includes('folder=%2Fvideos'))).toBe(true);
    expect(requests.some((url) => url.includes('refresh=true'))).toBe(true);
  });
});
