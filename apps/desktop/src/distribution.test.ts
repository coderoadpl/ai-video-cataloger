import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const packageSchema = z.object({ scripts: z.record(z.string(), z.string()) });

describe('macOS distribution', () => {
  it('builds the renderer, desktop entrypoints, and staged CLI before packaging a DMG', async () => {
    const metadata = packageSchema.parse(JSON.parse(await readFile('package.json', 'utf8')));
    const builderConfig = await readFile('electron-builder.config.js', 'utf8');

    expect(metadata.scripts['electron:build']).toBe(
      'npm run electron:build:renderer && npm run electron:build:desktop && npm run package:stage',
    );
    expect(metadata.scripts['electron:package']).toBe(
      'npm run electron:build && electron-builder --config electron-builder.config.js',
    );
    expect(builderConfig).toMatch(/target:\s*'dmg'/u);
  });

  it('documents first-open recovery, v1.1 features, and the signing backlog', async () => {
    const [readme, backlog] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('tasks/backlog.md', 'utf8'),
    ]);

    expect(readme).toContain('## First Open on macOS');
    expect(readme).toContain('right-click **AI Video Cataloger**');
    expect(readme).toContain('**System Settings → Privacy & Security**');
    expect(readme).toContain('**Open Anyway**');
    expect(readme).toContain("## What's New in v1.1");
    expect(readme).toContain('OpenAI-compatible API');
    expect(readme).toContain('Setup Wizard');
    expect(readme).toContain('managed whisper.cpp runtime');
    expect(backlog).toContain('Developer ID certificate');
    expect(backlog).toContain('Apple notarization');
  });
});
