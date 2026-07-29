import { spawnSync } from 'node:child_process';
import { constants, accessSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';

export interface ReadOnlyMount {
  mountpoint: string;
  imagePath: string;
}

export interface ReadOnlyMountOptions {
  tag: string;
  populate: (writableRoot: string) => Promise<void>;
  sizeMegabytes?: number;
  filesystem?: 'ExFAT' | 'HFS+';
}

export interface TreeEntry {
  path: string;
  kind: 'file' | 'directory' | 'symlink';
  size: number;
  mtimeMs: number;
}

const errnoSchema = z.object({ code: z.string() });

const toPosixPath = (root: string, absolute: string): string => relative(root, absolute).split(sep).join('/');

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const runHdiutil = (args: readonly string[]): CommandResult => {
  const result = spawnSync('hdiutil', args, { encoding: 'utf8', timeout: 120_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

const commandFailureMessage = (command: string, args: readonly string[], result: CommandResult): string =>
  `${command} ${args.join(' ')} failed (exit ${String(result.status)})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;

export const diskImageUnavailableReason = (): string | null => {
  if (process.platform !== 'darwin') {
    return `a real read-only mount leg requires macOS hdiutil; found ${process.platform}`;
  }
  const probe = runHdiutil(['info']);
  if (probe.status !== 0) return `hdiutil is present but unusable: ${probe.stderr}`;
  return null;
};

interface DetachOutcome {
  succeeded: boolean;
  last: { status: number | null; stdout: string; stderr: string };
}

const detachWithRetries = (mountpoint: string): DetachOutcome => {
  let last = runHdiutil(['detach', mountpoint]);
  for (let attempt = 0; attempt < 5 && last.status !== 0; attempt += 1) {
    spawnSync('/bin/sleep', ['2']);
    last = runHdiutil(['detach', mountpoint]);
  }
  if (last.status === 0) return { succeeded: true, last };
  last = runHdiutil(['detach', mountpoint, '-force']);
  return { succeeded: last.status === 0, last };
};

export const releaseReadOnlyMount = (mount: ReadOnlyMount): void => {
  // The retry exists because the CLI may still hold the mount when the test ends.
  try {
    const outcome = detachWithRetries(mount.mountpoint);
    if (!outcome.succeeded) console.error(`releaseReadOnlyMount: detach never succeeded for ${mount.mountpoint}`, outcome.last);
  } catch (error) {
    console.error(`releaseReadOnlyMount: detach failed for ${mount.mountpoint}`, error);
  }
  try {
    rmSync(mount.mountpoint, { recursive: true, force: true });
  } catch (error) {
    console.error(`releaseReadOnlyMount: cleanup of ${mount.mountpoint} failed`, error);
  }
  try {
    rmSync(dirname(mount.imagePath), { recursive: true, force: true });
  } catch (error) {
    console.error(`releaseReadOnlyMount: cleanup of ${dirname(mount.imagePath)} failed`, error);
  }
};

export const createReadOnlyMount = async (options: ReadOnlyMountOptions): Promise<ReadOnlyMount> => {
  const sizeMegabytes = options.sizeMegabytes ?? 64;
  const filesystem = options.filesystem ?? 'ExFAT';
  const imageDirectory = mkdtempSync(join(tmpdir(), 'avc-ro-image-'));
  const imagePath = join(imageDirectory, `${options.tag}.dmg`);
  const mountpoint = mkdtempSync(join(tmpdir(), 'avc-ro-mount-'));
  const mount: ReadOnlyMount = { mountpoint, imagePath };

  const fail = (message: string): never => {
    releaseReadOnlyMount(mount);
    throw new Error(message);
  };

  const createArgs = ['create', '-size', `${String(sizeMegabytes)}m`, '-fs', filesystem, '-volname', 'AVC-RO', imagePath];
  const create = runHdiutil(createArgs);
  if (create.status !== 0) fail(commandFailureMessage('hdiutil', createArgs, create));

  const attachArgs = ['attach', imagePath, '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mountpoint];
  const attach = runHdiutil(attachArgs);
  if (attach.status !== 0) fail(commandFailureMessage('hdiutil', attachArgs, attach));

  try {
    await options.populate(mountpoint);
  } catch (error) {
    fail(`populate() failed for ${mountpoint}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const detach = detachWithRetries(mountpoint);
  if (!detach.succeeded) fail(commandFailureMessage('hdiutil', ['detach', mountpoint], detach.last));

  const reattachArgs = ['attach', imagePath, '-readonly', '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mountpoint];
  const reattach = runHdiutil(reattachArgs);
  if (reattach.status !== 0) fail(commandFailureMessage('hdiutil', reattachArgs, reattach));

  let writable = false;
  try {
    accessSync(mountpoint, constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  if (writable) fail(`attached image is writable at ${mountpoint}; refusing to run a read-only leg against it`);

  return mount;
};

export const probeReadOnlyWriteRejection = (mountpoint: string): string => {
  try {
    mkdirSync(join(mountpoint, '.avc-ro-probe'), { recursive: true });
    return 'WRITE_SUCCEEDED';
  } catch (error) {
    const parsed = errnoSchema.safeParse(error);
    return parsed.success ? parsed.data.code : 'UNKNOWN';
  }
};

export const describeTree = (root: string): TreeEntry[] => {
  const entries: TreeEntry[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const absolute = join(directory, name);
      const stats = lstatSync(absolute);
      const kind: TreeEntry['kind'] = stats.isSymbolicLink() ? 'symlink' : stats.isDirectory() ? 'directory' : 'file';
      entries.push({ path: toPosixPath(root, absolute), kind, size: stats.size, mtimeMs: stats.mtimeMs });
      if (kind === 'directory') walk(absolute);
    }
  };
  walk(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
};

export const treeDifference = (before: readonly TreeEntry[], after: readonly TreeEntry[]): string[] => {
  const differences: string[] = [];
  const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.map((entry) => [entry.path, entry]));

  for (const [path, entry] of afterByPath) {
    const previous = beforeByPath.get(path);
    if (previous === undefined) {
      differences.push(`added: ${path}`);
      continue;
    }
    if (previous.kind !== entry.kind) {
      differences.push(`changed: ${path} (kind ${previous.kind} -> ${entry.kind})`);
    }
    if (previous.size !== entry.size) {
      differences.push(`changed: ${path} (size ${String(previous.size)} -> ${String(entry.size)})`);
    }
    if (previous.mtimeMs !== entry.mtimeMs) {
      differences.push(`changed: ${path} (mtimeMs ${String(previous.mtimeMs)} -> ${String(entry.mtimeMs)})`);
    }
  }
  for (const path of beforeByPath.keys()) {
    if (!afterByPath.has(path)) differences.push(`removed: ${path}`);
  }

  return differences.sort();
};
