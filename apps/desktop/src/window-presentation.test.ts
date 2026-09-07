import { afterEach, describe, expect, it, vi } from 'vitest';

import { windowPresentation } from './window-presentation.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('windowPresentation', () => {
  it('presents the window normally when the flag is absent or not exactly "1"', () => {
    expect(windowPresentation(undefined, 'darwin')).toEqual({ inactive: false, hideDock: false });
    expect(windowPresentation('', 'darwin')).toEqual({ inactive: false, hideDock: false });
    expect(windowPresentation('0', 'darwin')).toEqual({ inactive: false, hideDock: false });
    expect(windowPresentation('true', 'darwin')).toEqual({ inactive: false, hideDock: false });
  });

  it('hides the window from the Dock on macOS when the flag is set', () => {
    expect(windowPresentation('1', 'darwin')).toEqual({ inactive: true, hideDock: true });
  });

  it('keeps the window inactive but leaves the Dock alone off macOS', () => {
    expect(windowPresentation('1', 'win32')).toEqual({ inactive: true, hideDock: false });
    expect(windowPresentation('1', 'linux')).toEqual({ inactive: true, hideDock: false });
  });

  it('reads the flag from the process environment by default', () => {
    vi.stubEnv('AVC_WINDOW_INACTIVE', '1');
    expect(windowPresentation().inactive).toBe(true);

    vi.stubEnv('AVC_WINDOW_INACTIVE', '');
    expect(windowPresentation().inactive).toBe(false);
  });
});
