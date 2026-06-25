/**
 * Architecture invariant greps for the GUI/CLI contract.
 *
 * These tests scan the source trees (src/, electron/) and assert that the
 * refactor invariants hold as plain-text facts, independent of ESLint:
 *   - catalog state is only mutated functionally inside use-catalog.ts
 *   - spawnId plumbing never leaks back into renderer components
 *   - the renderer talks to the CLI only through useCliCommand (+ test mock)
 *   - the deleted file:* IPC surface (readAsDataUrl & co.) stays deleted
 *   - legacy summary parsing (summaryContent / video-content) stays deleted
 *   - the SUGGESTED FILENAME marker is owned by summary-format.ts alone
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that contain build output or dependencies, never source. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'release', 'coverage']);

/** Recursively list all .ts/.tsx files under a directory (absolute paths). */
function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...listSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Repo-relative posix paths of files whose content matches the pattern. */
function filesContaining(roots: string[], pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const root of roots) {
    for (const file of listSourceFiles(join(repoRoot, root))) {
      if (pattern.test(readFileSync(file, 'utf8'))) {
        matches.push(relative(repoRoot, file).split(sep).join('/'));
      }
    }
  }
  return matches.sort();
}

describe('architecture invariants', () => {
  it('functional setVideos updates live only in use-catalog.ts', () => {
    const offenders = filesContaining(['electron/renderer/src'], /setVideos\(\(prev/).filter(
      (file) => file !== 'electron/renderer/src/hooks/use-catalog.ts'
    );
    expect(offenders).toEqual([]);
  });

  it('no _spawnId plumbing in the renderer', () => {
    expect(filesContaining(['electron/renderer/src'], /_spawnId/)).toEqual([]);
  });

  it('electronAPI.cli is touched only by useCliCommand and the test mock', () => {
    const allowed = new Set([
      'electron/renderer/src/hooks/use-cli-command.ts',
      'electron/renderer/src/test/electron-api-mock.ts',
    ]);
    const offenders = filesContaining(
      ['electron/renderer/src'],
      /electronAPI\??\.cli\b/
    ).filter((file) => !allowed.has(file));
    expect(offenders).toEqual([]);
  });

  it('the deleted readAsDataUrl channel stays deleted', () => {
    expect(filesContaining(['src', 'electron'], /readAsDataUrl/)).toEqual([]);
  });

  it('legacy summaryContent parsing stays deleted', () => {
    expect(filesContaining(['src', 'electron'], /summaryContent/)).toEqual([]);
  });

  it('legacy video-content events stay deleted from the CLI', () => {
    expect(filesContaining(['src'], /video-content/)).toEqual([]);
  });

  it('the SUGGESTED FILENAME marker is owned by summary-format.ts alone', () => {
    const offenders = filesContaining(['src', 'electron'], /SUGGESTED FILENAME/).filter(
      (file) => file !== 'src/services/summary-format.ts'
    );
    expect(offenders).toEqual([]);
  });
});
