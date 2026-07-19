import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packagedCommandName = 'ai-video-cataloger';
const devCommandName = 'ai-video-cataloger-dev';
const installDirectory = '/usr/local/bin';

export type CliInstallOutcome = { ok: true; path: string } | { ok: false; reason: string };

export interface PackagedCliWrapperPaths {
  appBinaryPath: string;
  cliEntryPath: string;
}

export interface DevCliWrapperPaths {
  nodePath: string;
  repoRoot: string;
  cliEntryPath: string;
}

export const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export const buildCliWrapperScript = (paths: PackagedCliWrapperPaths): string =>
  [
    '#!/bin/sh',
    `ELECTRON_RUN_AS_NODE=1 exec ${shellSingleQuote(paths.appBinaryPath)} ${shellSingleQuote(paths.cliEntryPath)} "$@"`,
    '',
  ].join('\n');

export const buildDevCliWrapperScript = (paths: DevCliWrapperPaths): string =>
  [
    '#!/bin/sh',
    `cd ${shellSingleQuote(paths.repoRoot)}`,
    `exec ${shellSingleQuote(paths.nodePath)} ${shellSingleQuote(paths.cliEntryPath)} "$@"`,
    '',
  ].join('\n');

export const buildPrivilegedInstallShellCommand = (temporaryScriptPath: string, targetPath: string): string =>
  [
    `mkdir -p ${shellSingleQuote(path.dirname(targetPath))}`,
    `cp ${shellSingleQuote(temporaryScriptPath)} ${shellSingleQuote(targetPath)}`,
    `chmod 755 ${shellSingleQuote(targetPath)}`,
  ].join(' && ');

export const buildOsascriptExpression = (shellCommand: string): string =>
  `do shell script ${JSON.stringify(shellCommand)} with administrator privileges`;

export const packagedCliPaths = (): PackagedCliWrapperPaths => ({
  appBinaryPath: process.execPath,
  cliEntryPath: path.join(process.resourcesPath, 'cli', 'index.js'),
});

export const devCliPaths = (): DevCliWrapperPaths => {
  const repoRoot = path.resolve(process.cwd());
  return {
    nodePath: 'node',
    repoRoot,
    cliEntryPath: path.join(repoRoot, 'dist', 'cli', 'index.js'),
  };
};

export const wrapperScriptForRuntime = (isPackaged: boolean): string =>
  isPackaged ? buildCliWrapperScript(packagedCliPaths()) : buildDevCliWrapperScript(devCliPaths());

export const commandNameForRuntime = (isPackaged: boolean): string => (isPackaged ? packagedCommandName : devCommandName);

export const installPathForRuntime = (isPackaged: boolean): string =>
  path.join(installDirectory, commandNameForRuntime(isPackaged));

export const installCommandLineTool = async (scriptContent: string, targetPath: string): Promise<CliInstallOutcome> => {
  try {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, scriptContent, { encoding: 'utf8', mode: 0o755 });
    await chmod(targetPath, 0o755);
    return { ok: true, path: targetPath };
  } catch (error) {
    if (!isPermissionError(error)) return { ok: false, reason: failureReason(error) };
  }

  let temporaryDirectory: string;
  try {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'avc-cli-install-'));
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
  const temporaryScriptPath = path.join(temporaryDirectory, path.basename(targetPath));
  try {
    await writeFile(temporaryScriptPath, scriptContent, { encoding: 'utf8', mode: 0o755 });
    await chmod(temporaryScriptPath, 0o755);
    const command = buildPrivilegedInstallShellCommand(temporaryScriptPath, targetPath);
    await execFileAsync('osascript', ['-e', buildOsascriptExpression(command)]);
    return { ok: true, path: targetPath };
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const installCurrentRuntimeCommandLineTool = async (isPackaged: boolean): Promise<CliInstallOutcome> =>
  installCommandLineTool(wrapperScriptForRuntime(isPackaged), installPathForRuntime(isPackaged));

const isPermissionError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM');

const failureReason = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Unable to install the command line tool.';
};
