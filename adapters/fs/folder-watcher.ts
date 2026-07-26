import { watch } from 'node:fs';

import { appError, err, ok, type AppError, type Result } from '@core/domain/index.js';
import type { FolderWatchHandle, FolderWatcherPort } from '@core/server/index.js';

const CATALOG_DIRECTORY_NAME = '.ai-video-cataloger';
const DEFAULT_DEBOUNCE_MS = 1500;

export const isIgnoredWatchPath = (relativePath: string): boolean =>
  relativePath.split(/[\\/]/).includes(CATALOG_DIRECTORY_NAME);

export type RecursiveWatch = (
  root: string,
  onEvent: (relativePath: string | null) => void,
  onFailure: (cause: unknown) => void,
) => FolderWatchHandle;

export interface NodeFolderWatcherPortOptions {
  debounceMs?: number | undefined;
  watchRecursive?: RecursiveWatch | undefined;
}

const nodeRecursiveWatch: RecursiveWatch = (root, onEvent, onFailure) => {
  const watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
    onEvent(typeof filename === 'string' ? filename : null);
  });
  watcher.on('error', onFailure);
  return { close: () => watcher.close() };
};

export class NodeFolderWatcherPort implements FolderWatcherPort {
  private readonly debounceMs: number;
  private readonly watchRecursive: RecursiveWatch;

  constructor(options: NodeFolderWatcherPortOptions = {}) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.watchRecursive = options.watchRecursive ?? nodeRecursiveWatch;
  }

  watch(
    root: string,
    onChange: () => void,
    onFailure?: (error: AppError) => void,
  ): Promise<Result<FolderWatchHandle, AppError>> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let handle: FolderWatchHandle | null = null;
    let ended = false;
    const cancelPending = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const end = (): void => {
      ended = true;
      cancelPending();
      handle?.close();
    };
    try {
      handle = this.watchRecursive(
        root,
        (relativePath) => {
          if (ended) return;
          if (relativePath !== null && isIgnoredWatchPath(relativePath)) return;
          cancelPending();
          timer = setTimeout(() => {
            timer = null;
            onChange();
          }, this.debounceMs);
        },
        (cause) => {
          if (ended) return;
          end();
          onFailure?.(appError('read_error', `Stopped watching folder: ${root}`, cause));
        },
      );
      if (ended) handle.close();
      return Promise.resolve(
        ok({
          close: () => {
            if (ended) return;
            end();
          },
        }),
      );
    } catch (error) {
      return Promise.resolve(err(appError('read_error', `Cannot watch folder: ${root}`, error)));
    }
  }
}
