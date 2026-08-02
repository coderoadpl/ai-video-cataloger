import { describe, expect, it } from 'vitest';

import { RENDERER_CSP, cspHeaders } from './csp.js';

describe('cspHeaders', () => {
  it('preserves unrelated headers', () => {
    const result = cspHeaders({ 'X-Frame-Options': ['DENY'] });
    expect(result['X-Frame-Options']).toEqual(['DENY']);
  });

  it('sets exactly one Content-Security-Policy header', () => {
    const result = cspHeaders({});
    expect(result['Content-Security-Policy']).toEqual([RENDERER_CSP]);
  });

  it('never allows a remote origin', () => {
    expect(RENDERER_CSP).not.toMatch(/https?:\/\//);
    expect(RENDERER_CSP).not.toContain('http:');
    expect(RENDERER_CSP).not.toContain('https:');
  });

  it('pins connect-src to self only', () => {
    const connectSrc = RENDERER_CSP.split('; ').find((directive) => directive.startsWith('connect-src'));
    expect(connectSrc).toBe("connect-src 'self'");
  });

  it('allows blob: media (for subtitle tracks) but never a data: media source', () => {
    const mediaSrc = RENDERER_CSP.split('; ').find((directive) => directive.startsWith('media-src'));
    expect(mediaSrc).toContain('blob:');
    expect(mediaSrc).not.toContain('data:');
  });

  it('allows the app-owned media: scheme for images and media', () => {
    const imgSrc = RENDERER_CSP.split('; ').find((directive) => directive.startsWith('img-src'));
    const mediaSrc = RENDERER_CSP.split('; ').find((directive) => directive.startsWith('media-src'));
    expect(imgSrc).toContain('media:');
    expect(mediaSrc).toContain('media:');
  });

  it('would go red if a remote tile origin were ever added', () => {
    const withTileOrigin = [
      ...RENDERER_CSP.split('; ').filter((directive) => !directive.startsWith('img-src')),
      "img-src 'self' data: blob: media: https://tile.openstreetmap.org",
    ].join('; ');
    expect(withTileOrigin).toMatch(/https?:\/\//);
  });
});
