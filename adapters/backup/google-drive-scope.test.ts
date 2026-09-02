import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceRoots = ['adapters', 'apps', 'core', 'scripts'];
const driveFileScope = 'https://www.googleapis.com/auth/drive.file';

describe('Google Drive OAuth scope', () => {
  it('keeps drive.file as the only auth/drive scope in production source', () => {
    const matches = productionSourceFiles()
      .flatMap((filePath) => authDriveMatches(filePath));

    expect(matches).toEqual([driveFileScope]);
  });
});

const productionSourceFiles = (): string[] =>
  sourceRoots.flatMap((root) => walk(path.join(repoRoot, root)))
    .filter((filePath) =>
      /\.(?:ts|tsx|js|mjs|cjs)$/.test(filePath)
      && !filePath.endsWith('.test.ts')
      && !filePath.endsWith('.test.tsx'));

const walk = (directory: string): string[] => {
  const entries = readdirSync(directory).flatMap((name) => {
    const entryPath = path.join(directory, name);
    const stats = statSync(entryPath);
    return stats.isDirectory() ? walk(entryPath) : [entryPath];
  });
  return entries.sort();
};

const authDriveMatches = (filePath: string): string[] => {
  const source = readFileSync(filePath, 'utf8');
  return [...source.matchAll(/https:\/\/www\.googleapis\.com\/auth\/drive(?:\.[A-Za-z0-9_-]+)?/g)]
    .map((match) => match[0]);
};
