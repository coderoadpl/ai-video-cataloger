import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import type { App } from '@server/src/create-app.js';

import { FolderWatchController } from './folder-watch.js';

const unusedJob = async (): Promise<never> => {
  throw new Error('jobs port is not exercised by the folder watch controller');
};

interface WatchRecorder {
  app: App;
  roots: string[];
  fire: (index: number) => void;
  stopped: () => number;
}

const recordingApp = (
  outcome: (root: string) => Result<{ stop: () => void }, AppError> = () => ok({ stop: () => undefined }),
): WatchRecorder => {
  const roots: string[] = [];
  const notifiers: Array<() => void> = [];
  let stopped = 0;
  const app: App = {
    honoApp: new Hono(),
    jobs: {
      enqueue: unusedJob,
      get: unusedJob,
      list: unusedJob,
      cancel: unusedJob,
      onSettled: () => undefined,
      acquireResource: unusedJob,
    },
    catalogFolderPaths: async () => [],
    watchFolder: (root, onChange) => {
      roots.push(root);
      notifiers.push(onChange);
      const result = outcome(root);
      if (!result.ok) return Promise.resolve(result);
      return Promise.resolve(
        ok({
          stop: () => {
            stopped += 1;
            result.value.stop();
          },
        }),
      );
    },
    dispose: async () => undefined,
  };
  return { app, roots, fire: (index) => notifiers[index]?.(), stopped: () => stopped };
};

describe('FolderWatchController', () => {
  it('notifies the renderer with the watched folder on a change', async () => {
    const recorder = recordingApp();
    const notify = vi.fn();
    const controller = new FolderWatchController({ desktopApp: Promise.resolve(recorder.app), notify });

    await controller.watch('/drive');
    recorder.fire(0);

    expect(recorder.roots).toEqual(['/drive']);
    expect(notify).toHaveBeenCalledWith('/drive');
  });

  it('stops the previous session when a new folder is opened', async () => {
    const recorder = recordingApp();
    const controller = new FolderWatchController({
      desktopApp: Promise.resolve(recorder.app),
      notify: () => undefined,
    });

    await controller.watch('/drive');
    await controller.watch('/other');

    expect(recorder.roots).toEqual(['/drive', '/other']);
    expect(recorder.stopped()).toBe(1);
  });

  it('discards a session that resolved after a newer watch started', async () => {
    const recorder = recordingApp();
    const controller = new FolderWatchController({
      desktopApp: Promise.resolve(recorder.app),
      notify: () => undefined,
    });

    const first = controller.watch('/drive');
    const second = controller.watch('/other');
    await Promise.all([first, second]);
    controller.stop();

    expect(recorder.stopped()).toBe(2);
  });

  it('keeps quiet when the folder cannot be watched', async () => {
    const recorder = recordingApp(() => ({ ok: false, error: appError('read_error', 'gone') }));
    const controller = new FolderWatchController({
      desktopApp: Promise.resolve(recorder.app),
      notify: () => undefined,
    });

    await controller.watch('/missing');
    controller.stop();

    expect(recorder.stopped()).toBe(0);
  });
});
