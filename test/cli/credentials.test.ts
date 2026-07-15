import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) cleanupTestDir(root);
  roots.length = 0;
});

describe('API credentials', () => {
  it('stores an environment credential at home with mode 0600 without emitting it', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    const secret = 'sk-cli-must-not-leak';
    const result = await runCli(['config', 'set-credential', 'openai', '--json'], {
      cwd: folder,
      env: { HOME: home, AI_VIDEO_CATALOGER_API_KEY: secret },
    });

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(secret);
    const credentialPath = join(home, '.ai-video-cataloger', 'credentials.json');
    expect(statSync(credentialPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(credentialPath, 'utf8'))).toEqual({ openai: secret });
    expect(existsSync(join(folder, '.ai-video-cataloger', 'config.json'))).toBe(false);
  });

  it('keeps the key out of events and debug artifacts after a failing configured API run', async () => {
    const home = createTestDir();
    const folder = createTestDir();
    roots.push(home, folder);
    const secret = 'sk-failing-run-must-not-leak';
    const env = { HOME: home, AI_VIDEO_CATALOGER_API_KEY: secret };
    await runCli(['config', 'set-credential', 'openai', '--json'], { cwd: folder, env });
    const provider = JSON.stringify({
      family: 'api',
      providerId: 'openai',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKeyRef: 'openai',
      model: 'vision-model',
      maxImageDetail: 'auto',
    });
    await runCli(['config', 'set', 'analyzer_provider', provider, '--json'], { cwd: folder, env });
    const videoPath = join(folder, 'broken.mp4');
    writeFileSync(videoPath, 'not a video');
    chmodSync(videoPath, 0o600);

    const result = await runCli([
      'process',
      videoPath,
      '--analyzer',
      'api',
      '--whisper',
      'skip',
      '--json',
    ], { cwd: folder, env });

    expect(result.exitCode).toBeGreaterThan(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(secret);
    const debugPath = join(folder, 'summaries', 'broken-debug.log');
    if (existsSync(debugPath)) expect(readFileSync(debugPath, 'utf8')).not.toContain(secret);
    expect(readFileSync(join(folder, '.ai-video-cataloger', 'config.json'), 'utf8')).not.toContain(secret);
  });
});
