import { fileURLToPath } from 'node:url';

import { checkInstalledRuntime } from './installed-runtime.js';

const runtime = checkInstalledRuntime(fileURLToPath(new URL('..', import.meta.url)));
if (runtime.ok) {
  process.stdout.write(runtime.value);
} else {
  process.stderr.write(`${runtime.error.message}\n`);
  process.exitCode = 1;
}
