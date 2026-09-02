// .claude/privacy-denylist.local contains exact private strings and must never be committed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const defaultRoot = path.join(import.meta.dirname, '..');
const repoRoot = path.resolve(process.argv[2] ?? defaultRoot);
const allowlistPath = path.join(repoRoot, 'scripts', 'privacy-lint.allow');
const denylistRelativePath = '.claude/privacy-denylist.local';
const denylistPath = path.join(repoRoot, denylistRelativePath);
const decoder = new TextDecoder('utf-8', { fatal: true });

const fail = (problems) => {
  process.stderr.write(`privacy-lint: FAIL — ${String(problems.length)} issue(s)\n`);
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(1);
};

const trackedRun = spawnSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
});

if (trackedRun.error) fail([`git:1 [configuration] could not enumerate tracked files`]);
if (trackedRun.status !== 0) fail([`git:1 [configuration] could not enumerate tracked files`]);

const trackedFiles = trackedRun.stdout.split('\0').filter((entry) => entry.length > 0);

if (trackedFiles.includes(denylistRelativePath)) {
  fail([`${denylistRelativePath}:1 [denylist-tracked] local denylist must not be tracked`]);
}

const parseAllowlist = () => {
  if (!existsSync(allowlistPath)) return new Set();
  const lines = readFileSync(allowlistPath, 'utf8').split(/\r?\n/);
  const entries = new Set();
  let previous = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim() ?? '';
    if (line.length === 0) {
      previous = '';
      continue;
    }
    if (line.startsWith('#')) {
      previous = line;
      continue;
    }
    const separator = line.lastIndexOf(':');
    if (separator <= 0 || separator === line.length - 1 || !previous.startsWith('#')) {
      fail([`scripts/privacy-lint.allow:${String(index + 1)} [allowlist-format] invalid allowlist entry`]);
    }
    entries.add(line);
    previous = line;
  }
  return entries;
};

const parseDenylist = () => {
  if (!existsSync(denylistPath)) return [];
  const entries = [];
  const lines = readFileSync(denylistPath, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const value = lines[index]?.trim() ?? '';
    if (value.length === 0 || value.startsWith('#')) continue;
    if (value.startsWith('/') && value.endsWith('/') && value.length > 2) {
      try {
        entries.push({ regex: new RegExp(value.slice(1, -1), 'u') });
      } catch {
        fail([`${denylistRelativePath}:${String(index + 1)} [denylist-format] invalid regular expression`]);
      }
    } else {
      entries.push({ literal: value });
    }
  }
  return entries;
};

const lockfiles = new Set([
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'composer.lock',
  'Gemfile.lock',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'Pipfile.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'yarn.lock',
]);
const binaryExtensions = new Set([
  '.7z',
  '.bin',
  '.db',
  '.dmg',
  '.gif',
  '.gz',
  '.icns',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.npy',
  '.onnx',
  '.otf',
  '.pdf',
  '.png',
  '.sqlite',
  '.tar',
  '.ttf',
  '.wasm',
  '.wav',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
]);

const isLockfile = (file) => lockfiles.has(path.basename(file));
const isBinaryFile = (file) => binaryExtensions.has(path.extname(file).toLowerCase());
const isFixtureFile = (file) =>
  /(?:^|\/)(?:fixtures?|__fixtures__)(?:\/|$)/iu.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(file);
const isSyntheticVolume = (name) => /^(?:test|fixture)[_-]?(?:volume|drive)?(?:[_-]?\d+)?$/iu.test(name);
const scratchPattern = new RegExp('repositories/claude-tmp', 'u');
const homePattern = /\/(?:Users|home)\/[^/\s"'`<>]+(?=\/)/u;
const volumePattern = /\/Volumes\/([^/\s"'`<>]+)/gu;
const emailPattern = /[A-Z0-9._%+-]+@([A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,})/giu;

const allowlist = parseAllowlist();
const denylist = parseDenylist();
const problems = [];
let scanned = 0;

const report = (file, line, className) => {
  if (allowlist.has(`${file}:${className}`)) return;
  problems.push(`${file}:${String(line)} [${className}]`);
};

for (const file of trackedFiles) {
  if (isLockfile(file) || isBinaryFile(file)) continue;
  const buffer = readFileSync(path.join(repoRoot, file));
  if (buffer.includes(0)) continue;
  let text;
  try {
    text = decoder.decode(buffer);
  } catch {
    continue;
  }
  scanned++;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (homePattern.test(line)) report(file, index + 1, 'home-path');
    if (scratchPattern.test(line)) report(file, index + 1, 'scratch-dir');
    for (const volume of line.matchAll(volumePattern)) {
      const name = volume[1] ?? '';
      if (!isFixtureFile(file) || !isSyntheticVolume(name)) report(file, index + 1, 'volume-name');
    }
    for (const email of line.matchAll(emailPattern)) {
      const address = email[0].toLowerCase();
      const domain = email[1]?.toLowerCase() ?? '';
      if (domain !== 'example.com' && !address.includes('noreply') && !address.includes('no-reply')) {
        report(file, index + 1, 'email');
      }
    }
    if (denylist.some((entry) =>
      entry.literal === undefined ? entry.regex.test(line) : line.includes(entry.literal)
    )) {
      problems.push(`${file}:${String(index + 1)} [denylist]`);
    }
  }
}

if (problems.length > 0) fail(problems);

process.stdout.write(`privacy-lint: OK — ${String(scanned)} tracked text file(s) scanned\n`);
