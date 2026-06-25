/**
 * Electron glue for the scoped media:// protocol.
 *
 * URL format: media://local/ENCODED where ENCODED = encodeURIComponent(absolutePath).
 * An optional query string (e.g. ?v=cacheKey) is ignored - it only exists as a
 * cache-buster for the renderer.
 */

import { protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import { getCurrentFolder } from './folder-store.js';
import { resolveScopedImage } from './media-scope.js';

/**
 * Register the media: scheme as privileged.
 * MUST be called before app.whenReady().
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { stream: true, bypassCSP: false } },
  ]);
}

/**
 * Register the media: protocol handler.
 * Must be called after the app is ready.
 */
export function registerMediaProtocolHandler(): void {
  protocol.handle('media', async (request): Promise<Response> => {
    let requestedPath: string;
    try {
      const url = new URL(request.url);
      // pathname is "/ENCODED"; strip the leading slash and decode ONCE
      const encoded = url.pathname.replace(/^\//, '');
      requestedPath = decodeURIComponent(encoded);
    } catch {
      // Malformed URL or invalid percent-encoding
      return new Response(null, { status: 403 });
    }

    const real = await resolveScopedImage(requestedPath, getCurrentFolder());
    if (real === null) {
      return new Response(null, { status: 403 });
    }

    return net.fetch(pathToFileURL(real).toString());
  });
}
