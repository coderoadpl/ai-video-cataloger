import { readFile } from 'node:fs/promises';
import path from 'node:path';

const nvmrcPath = path.join(process.cwd(), '.nvmrc');

let expectedVersion;

try {
  expectedVersion = (await readFile(nvmrcPath, 'utf8')).trim().replace(/^v/, '');
} catch {
  console.error('Node version check failed: could not read .nvmrc; run: nvm use');
  process.exit(1);
}

const actualVersion = process.version.replace(/^v/, '');

if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
  console.error(`Node version check failed: invalid .nvmrc version "${expectedVersion}"; run: nvm use`);
  process.exit(1);
}

if (actualVersion !== expectedVersion) {
  console.error(
    `Node version mismatch: expected ${expectedVersion} from .nvmrc, running ${actualVersion}; run: nvm use`,
  );
  process.exit(1);
}
