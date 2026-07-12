/**
 * Electron main = composition root (US-403). It alone (with its preload
 * adapter) may import `electron`; the lint boundaries encode that even while
 * this is only a stub.
 */
export const APP_DESKTOP_PLACEHOLDER = 'desktop' as const;
