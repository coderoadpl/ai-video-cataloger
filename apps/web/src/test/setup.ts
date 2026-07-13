import { cleanup } from '@testing-library/react';
import { afterAll, afterEach } from 'vitest';

import { server } from './server.js';

/**
 * Start MSW at module scope, before any test file (and thus `api.ts`) is
 * imported, and before the fetch/Request wrappers below capture it — so the
 * signal patch layers on top of MSW's patched fetch, not the raw undici one.
 */
server.listen({ onUnhandledRequest: 'error' });

/**
 * jsdom has no `matchMedia`; MUI's `useMediaQuery` (the theme's OS-appearance
 * follow) calls it. Stub it to report the light scheme so themed components
 * render deterministically.
 */
const stubMatchMedia = (query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
});
globalThis.matchMedia = stubMatchMedia;

/**
 * jsdom and undici expose AbortSignal from different realms, so the signal
 * TanStack Query attaches fails undici's `instanceof` check inside MSW's fetch
 * cloning and inside `new Request()`. Tests never abort, so drop the signal at
 * both seams, layered on top of MSW's patched fetch.
 */
const dropSignal = (init?: RequestInit): RequestInit | undefined =>
  init === undefined ? init : { ...init, signal: null };

const patchedFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  patchedFetch(input, dropSignal(init));
const OriginalRequest = globalThis.Request;
globalThis.Request = class extends OriginalRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, dropSignal(init));
  }
};

afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
