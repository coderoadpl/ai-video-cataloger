import { Command } from 'commander';

import { createApiClient } from '@core/client/index.js';
import { err, notFound } from '@core/domain/index.js';
import { createApp } from '@server/src/create-app.js';

import { emit } from './output.js';

const program = new Command('ai-video-cataloger')
  .description('AI Video Cataloger — local-first CLI over the in-process contract')
  .option('--json', 'machine-readable JSON output', false);

const { honoApp } = createApp();
const api = createApiClient({
  baseUrl: '',
  fetchImpl: async (input, init) => honoApp.request(input, init),
});

const isJson = (): boolean => program.opts<{ json: boolean }>().json;

program
  .command('health')
  .description('App and version status')
  .action(async () => {
    emit(await api.health(), isJson(), (h) => `status=${h.status} v${h.version}`);
  });

/** Hidden diagnostic: exercises the taxonomy exit-code path end-to-end for the smoke gate. */
const failCommand = new Command('__fail')
  .description('Force a taxonomy error (smoke diagnostic)')
  .action(() => {
    emit(err(notFound('forced error for smoke')), isJson(), () => '');
  });
program.addCommand(failCommand, { hidden: true });

await program.parseAsync(process.argv);
