import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PhotosLayout } from './PhotosLayout.js';

describe('PhotosLayout skeleton', () => {
  it('renders copy and content only through slots', () => {
    render(
      <PhotosLayout
        heading={<h1>heading-slot</h1>}
        toolbar={<button type="button">toolbar-slot</button>}
        notice={<div>notice-slot</div>}
        grid={<article>grid-slot</article>}
        detail={<aside>detail-slot</aside>}
      />,
    );

    expect(screen.getByText('heading-slot')).toBeDefined();
    expect(screen.getByText('toolbar-slot')).toBeDefined();
    expect(screen.getByText('notice-slot')).toBeDefined();
    expect(screen.getByText('grid-slot')).toBeDefined();
    expect(screen.getByText('detail-slot')).toBeDefined();
    expect(screen.getByTestId('photos-layout-split').children).toHaveLength(2);
  });

  it('omits the notice region when no notice is supplied', () => {
    render(
      <PhotosLayout
        heading={<h1>heading-slot</h1>}
        toolbar={<button type="button">toolbar-slot</button>}
        grid={<article>grid-slot</article>}
        detail={<aside>detail-slot</aside>}
      />,
    );

    expect(screen.queryByText('notice-slot')).toBeNull();
  });
});
