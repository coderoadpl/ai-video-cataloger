import { describe, expect, it, vi } from 'vitest';

const { showMessageBox, buildFromTemplate, setApplicationMenu } = vi.hoisted(() => ({
  showMessageBox: vi.fn().mockResolvedValue(undefined),
  buildFromTemplate: vi.fn((template: unknown) => template),
  setApplicationMenu: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { name: 'AI Video Cataloger', isPackaged: false, getVersion: () => '1.0.0' },
  dialog: { showMessageBox },
  Menu: { buildFromTemplate, setApplicationMenu },
  shell: { openExternal: vi.fn() },
}));

import type * as CliInstall from './cli-install.js';

vi.mock('./cli-install.js', async () => {
  const actual = await vi.importActual<typeof CliInstall>('./cli-install.js');
  return {
    ...actual,
    installCurrentRuntimeCommandLineTool: vi.fn().mockResolvedValue({ ok: true, path: '/usr/local/bin/ai-video-cataloger' }),
  };
});

vi.mock('@adapters/cli-path/index.js', () => ({
  NodeCliPathAdapter: vi.fn().mockImplementation(() => ({
    resolveOnPath: vi.fn().mockRejectedValue(new Error('PATH scan blew up')),
  })),
}));

import { cliInstallSuccessMessage, createApplicationMenu } from './menu.js';

interface MenuTemplateItem {
  label?: string;
  submenu?: unknown;
  click?: (...args: readonly unknown[]) => void;
}

const isMenuTemplateItemArray = (value: unknown): value is MenuTemplateItem[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null);

const findMenuItem = (items: readonly MenuTemplateItem[], label: string): MenuTemplateItem | undefined => {
  for (const item of items) {
    if (item.label === label) return item;
    if (isMenuTemplateItemArray(item.submenu)) {
      const found = findMenuItem(item.submenu, label);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

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

  it('still shows the install-success dialog when the shadow-guidance PATH scan throws', async () => {
    showMessageBox.mockClear();
    setApplicationMenu.mockClear();

    createApplicationMenu(null, []);
    const template = setApplicationMenu.mock.calls[0]?.[0];
    if (!isMenuTemplateItemArray(template)) throw new Error('Expected a menu template');
    const installItem = findMenuItem(template, 'Install Command Line Tool…');
    if (installItem?.click === undefined) throw new Error('Expected an Install Command Line Tool menu item');

    installItem.click();

    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
    expect(showMessageBox.mock.calls[0]?.[0]).toMatchObject({ type: 'info' });
  });
});
