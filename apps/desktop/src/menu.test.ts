import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { name: 'AI Video Cataloger', isPackaged: false },
  dialog: { showMessageBox: vi.fn() },
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => template),
    setApplicationMenu: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
}));

import { cliInstallSuccessMessage } from './menu.js';

describe('application menu', () => {
  it('shows the installed production command name in the CLI install success message', () => {
    expect(cliInstallSuccessMessage('/usr/local/bin/ai-video-cataloger')).toBe(
      'Installed. Run ai-video-cataloger in your terminal.\n\n/usr/local/bin/ai-video-cataloger',
    );
  });

  it('shows the installed development command name in the CLI install success message', () => {
    expect(cliInstallSuccessMessage('/usr/local/bin/ai-video-cataloger-dev')).toBe(
      'Installed. Run ai-video-cataloger-dev in your terminal.\n\n/usr/local/bin/ai-video-cataloger-dev',
    );
  });
});
