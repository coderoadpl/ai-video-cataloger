import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';

import { parseMediaUrl, resolveScopedImage } from './media-scope.js';

export interface MediaProtocolDeps {
  getCurrentFolder(): Promise<string | null>;
  getFacesRoot?(): Promise<string | null>;
}

export const registerMediaScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { stream: true, bypassCSP: false } },
  ]);
};

export const registerMediaProtocolHandler = (deps: MediaProtocolDeps): void => {
  protocol.handle('media', async (request): Promise<Response> => {
    const requestedPath = parseMediaUrl(request.url);
    if (requestedPath === null) return new Response(null, { status: 403 });

    const facesRoot = await deps.getFacesRoot?.();
    const realPath = await resolveScopedImage(
      requestedPath,
      await deps.getCurrentFolder(),
      undefined,
      facesRoot === undefined || facesRoot === null ? [] : [facesRoot],
    );
    if (realPath === null) return new Response(null, { status: 403 });

    return net.fetch(pathToFileURL(realPath).toString());
  });
};
