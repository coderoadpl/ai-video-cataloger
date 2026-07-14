import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { runCli } from '../helpers/cli-runner.js';

const packageMetadataSchema = z.object({ version: z.string() });

describe('CLI version', () => {
  it('prints the package version instead of an independently hardcoded value', async () => {
    const metadata = packageMetadataSchema.parse(JSON.parse(await readFile('package.json', 'utf8')));

    const result = await runCli(['--version']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(metadata.version);
  });
});
