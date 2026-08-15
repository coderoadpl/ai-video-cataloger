import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { LibrarySubnav } from './LibrarySubnav.js';

describe('LibrarySubnav', () => {
  it('renders exactly Kolekcja, Osoby and Mapa', () => {
    renderWithProviders(<LibrarySubnav surface="collection" onSelect={vi.fn()} />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Collection',
      'People',
      'Map',
    ]);
  });
});
