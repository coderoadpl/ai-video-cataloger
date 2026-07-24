import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '../query-client.js';
import { GalleryApp } from './GalleryApp.js';

const container = document.getElementById('gallery-root');
if (!container) throw new Error('Missing #gallery-root element');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <GalleryApp />
    </QueryClientProvider>
  </StrictMode>,
);
