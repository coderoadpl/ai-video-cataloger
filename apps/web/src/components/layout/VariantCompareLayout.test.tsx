import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VariantCompareLayout } from './VariantCompareLayout.js';

describe('VariantCompareLayout skeleton', () => {
  it('renders copy and content only through slots', () => {
    render(
      <VariantCompareLayout
        heading={<h1>heading-slot</h1>}
        actions={<button type="button">action-slot</button>}
        notice={<div>notice-slot</div>}
        columns={
          <>
            <article>first-column-slot</article>
            <article>second-column-slot</article>
          </>
        }
      />,
    );

    expect(screen.getByText('heading-slot')).toBeDefined();
    expect(screen.getByText('action-slot')).toBeDefined();
    expect(screen.getByText('notice-slot')).toBeDefined();
    expect(screen.getByText('first-column-slot')).toBeDefined();
    expect(screen.getByText('second-column-slot')).toBeDefined();
    expect(screen.getByTestId('variant-compare-columns').children).toHaveLength(2);
  });

  it('omits the notice region when no notice is supplied', () => {
    render(
      <VariantCompareLayout
        heading={<h1>heading-slot</h1>}
        actions={<button type="button">action-slot</button>}
        columns={<article>column-slot</article>}
      />,
    );

    expect(screen.queryByText('notice-slot')).toBeNull();
    expect(screen.getByText('column-slot')).toBeDefined();
  });
});
