export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: media:",
  "media-src 'self' blob: media:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const cspHeaders = (
  existing: Record<string, string[] | undefined>,
): Record<string, string[] | undefined> => ({
  ...existing,
  'Content-Security-Policy': [RENDERER_CSP],
});
