import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(import.meta.dirname, '..');
const lockfile = path.join(repoRoot, 'pnpm-lock.yaml');

const fail = (message) => {
  console.error(`lock-lint: FAIL\n${message}`);
  process.exit(1);
};

if (!existsSync(lockfile)) {
  fail('pnpm-lock.yaml is missing; nothing pins the dependency tree. Run: pnpm install');
}

const pnpmCli = process.env.npm_execpath;
const [command, leadingArgs] = pnpmCli === undefined ? ['pnpm', []] : [process.execPath, [pnpmCli]];
const frozen = spawnSync(command, [...leadingArgs, 'install', '--frozen-lockfile', '--lockfile-only'], {
  cwd: repoRoot,
  encoding: 'utf8',
});

if (frozen.error) fail(`could not run pnpm: ${String(frozen.error)}`);
if (frozen.status !== 0) {
  fail(`pnpm-lock.yaml no longer agrees with package.json. Run: pnpm install\n${frozen.stderr}${frozen.stdout}`);
}

console.log('lock-lint: OK — pnpm-lock.yaml is present and resolves under frozen-lockfile semantics');
