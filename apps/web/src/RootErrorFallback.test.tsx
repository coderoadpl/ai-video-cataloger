import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@core/client/index.js';
import { notFound } from '@core/domain/index.js';

import { RootErrorFallback, renderRootErrorFallback } from './RootErrorFallback.js';

describe('renderRootErrorFallback', () => {
  it('surfaces an ApiError message verbatim without re-mapping the taxonomy', () => {
    render(renderRootErrorFallback(new ApiError(notFound('That video is gone'))));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Something went wrong');
    expect(alert.textContent).toContain('That video is gone');
  });

  it('uses a generic detail for a non-ApiError throw', () => {
    render(renderRootErrorFallback(new Error('boom')));

    expect(screen.getByRole('alert').textContent).toContain('An unexpected error interrupted');
  });
});

describe('RootErrorFallback', () => {
  it('renders the active trace id when one is present', () => {
    render(<RootErrorFallback error={new Error('boom')} traceId="0af7651916cd43dd8448eb211c80319c" />);

    expect(screen.getByRole('alert').textContent).toContain(
      'Trace ID: 0af7651916cd43dd8448eb211c80319c',
    );
  });

  it('omits the trace id line when tracing is inactive', () => {
    render(<RootErrorFallback error={new Error('boom')} traceId={undefined} />);

    expect(screen.getByRole('alert').textContent).not.toContain('Trace ID');
  });
});
