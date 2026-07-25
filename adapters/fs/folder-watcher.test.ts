import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FolderWatchHandle } from '@core/server/index.js';

import { isIgnoredWatchPath, NodeFolderWatcherPort, type RecursiveWatch } from './folder-watcher.js';

interface FakeWatch {
  watchRecursive: RecursiveWatch;
  emit: (relativePath: string | null) => void;
  closed: () => number;
  roots: string[];
}

const fakeWatch = (): FakeWatch => {
  const listeners: Array<(relativePath: string | null) => void> = [];
  const roots: string[] = [];
  let closed = 0;
  const watchRecursive: RecursiveWatch = (root, onEvent): FolderWatchHandle => {
    roots.push(root);
    listeners.push(onEvent);
    return {
      close: () => {
        closed += 1;
      },
    };
  };
  return {
    watchRecursive,
    emit: (relativePath) => {
      for (const listener of listeners) listener(relativePath);
    },
    closed: () => closed,
    roots,
  };
};

describe('isIgnoredWatchPath', () => {
  it('ignores the catalog directory and everything below it', () => {
    expect(isIgnoredWatchPath('.ai-video-cataloger')).toBe(true);
    expect(isIgnoredWatchPath('.ai-video-cataloger/folder-id')).toBe(true);
    expect(isIgnoredWatchPath('sub/.ai-video-cataloger/snapshot.json')).toBe(true);
    expect(isIgnoredWatchPath('sub\\.ai-video-cataloger\\snapshot.json')).toBe(true);
  });

  it('keeps ordinary media paths', () => {
    expect(isIgnoredWatchPath('clip.mp4')).toBe(false);
    expect(isIgnoredWatchPath('sub/clip.mp4')).toBe(false);
    expect(isIgnoredWatchPath('ai-video-cataloger/clip.mp4')).toBe(false);
  });
});

describe('NodeFolderWatcherPort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses a burst of events into a single debounced change', async () => {
    const watch = fakeWatch();
    const port = new NodeFolderWatcherPort({ debounceMs: 1000, watchRecursive: watch.watchRecursive });
    const onChange = vi.fn();

    const started = await port.watch('/drive', onChange);

    expect(started.ok).toBe(true);
    expect(watch.roots).toEqual(['/drive']);
    watch.emit('a.mp4');
    vi.advanceTimersByTime(400);
    watch.emit('b.mp4');
    vi.advanceTimersByTime(400);
    watch.emit('c.mp4');
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reports separate bursts separately', async () => {
    const watch = fakeWatch();
    const port = new NodeFolderWatcherPort({ debounceMs: 1000, watchRecursive: watch.watchRecursive });
    const onChange = vi.fn();

    await port.watch('/drive', onChange);

    watch.emit('a.mp4');
    vi.advanceTimersByTime(1000);
    watch.emit('b.mp4');
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not react to catalog directory writes', async () => {
    const watch = fakeWatch();
    const port = new NodeFolderWatcherPort({ debounceMs: 1000, watchRecursive: watch.watchRecursive });
    const onChange = vi.fn();

    await port.watch('/drive', onChange);

    watch.emit('.ai-video-cataloger/folder-id');
    watch.emit('sub/.ai-video-cataloger/catalog.json');
    vi.advanceTimersByTime(5000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('treats an unnamed event as a change', async () => {
    const watch = fakeWatch();
    const port = new NodeFolderWatcherPort({ debounceMs: 1000, watchRecursive: watch.watchRecursive });
    const onChange = vi.fn();

    await port.watch('/drive', onChange);

    watch.emit(null);
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('closing cancels a pending debounce and releases the underlying watcher', async () => {
    const watch = fakeWatch();
    const port = new NodeFolderWatcherPort({ debounceMs: 1000, watchRecursive: watch.watchRecursive });
    const onChange = vi.fn();

    const started = await port.watch('/drive', onChange);
    if (!started.ok) throw new Error('watch failed');

    watch.emit('a.mp4');
    started.value.close();
    vi.advanceTimersByTime(5000);

    expect(onChange).not.toHaveBeenCalled();
    expect(watch.closed()).toBe(1);
  });

  it('returns a read error when the folder cannot be watched', async () => {
    const port = new NodeFolderWatcherPort({
      watchRecursive: () => {
        throw new Error('ENOENT');
      },
    });

    const started = await port.watch('/missing', () => undefined);

    expect(started.ok).toBe(false);
    expect(started.ok ? null : started.error.code).toBe('read_error');
  });
});
