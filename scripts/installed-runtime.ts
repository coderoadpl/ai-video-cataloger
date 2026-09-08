import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { appError, err, ok, type AppError, type Result } from '../core/domain/index.js';

const dependenciesSchema = z.record(z.string(), z.string());
const manifestSchema = z.object({
  dependencies: dependenciesSchema.optional(),
  devDependencies: dependenciesSchema.optional(),
});
const versionSchema = z.object({ version: z.string().min(1) });
const lockedDependenciesSchema = z.record(z.string(), versionSchema);
const lockListSchema = z.array(z.object({
  dependencies: lockedDependenciesSchema.optional(),
  devDependencies: lockedDependenciesSchema.optional(),
})).length(1);
const reinstall = 'Run: pnpm install --frozen-lockfile --force';

export const checkInstalledVersions = (root: string, rawLockList: unknown): Result<string, AppError> => {
  try {
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    const [locked] = lockListSchema.parse(rawLockList);
    const expected = { ...locked?.dependencies, ...locked?.devDependencies };
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    const problems: string[] = [];
    for (const name of Object.keys(declared)) {
      const version = expected[name]?.version;
      if (version === undefined) {
        problems.push(`${name}: missing lockfile resolution`);
        continue;
      }
      try {
        const installed = versionSchema.parse(JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')));
        if (installed.version !== version) problems.push(`${name}: installed ${installed.version}, locked ${version}`);
      } catch {
        problems.push(`${name}: installed package metadata missing or invalid`);
      }
    }
    const electron = expected.electron?.version;
    if (electron === undefined) problems.push('electron: missing lockfile resolution');
    try {
      const runtime = readFileSync(join(root, 'node_modules/electron/dist/version'), 'utf8').trim().replace(/^v/, '');
      if (runtime !== electron) problems.push(`electron binary: installed ${runtime}, locked ${electron ?? 'missing'}`);
    } catch {
      problems.push('electron binary: installed version file missing');
    }
    if (problems.length > 0 || electron === undefined) {
      return err(appError('prerequisites_failed', `Installed dependency versions do not match the lockfile:\n${problems.join('\n')}\n${reinstall}`));
    }
    return ok(electron);
  } catch {
    return err(appError('prerequisites_failed', `Cannot validate installed dependencies against the lockfile. ${reinstall}`));
  }
};

export const checkInstalledRuntime = (root: string): Result<string, AppError> => {
  if (!existsSync(join(root, 'pnpm-lock.yaml'))) return err(appError('prerequisites_failed', `Lockfile missing. ${reinstall}`));
  const pnpmCli = process.env.npm_execpath;
  const [command, leadingArgs] = pnpmCli === undefined ? ['pnpm', []] as const : [process.execPath, [pnpmCli]] as const;
  const listed = spawnSync(command, [...leadingArgs, 'list', '--depth', '0', '--json', '--lockfile-only'], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (listed.status !== 0) return err(appError('prerequisites_failed', `Cannot read lockfile resolutions. ${reinstall}`));
  try {
    return checkInstalledVersions(root, JSON.parse(listed.stdout));
  } catch {
    return err(appError('prerequisites_failed', `Invalid lockfile resolution report. ${reinstall}`));
  }
};
