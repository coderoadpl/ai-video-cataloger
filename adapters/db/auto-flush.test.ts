import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAutoFlush, createAutoFlushState, scheduleAutoFlush } from './auto-flush.js';

describe('auto-flush process signal hooks', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    vi.restoreAllMocks();
  });

  it('does not re-raise a termination signal when another listener still owns it', () => {
    const state = createAutoFlushState();
    const flush = vi.fn();
    const existing = vi.fn();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    process.on('SIGTERM', existing);
    cleanups.push(() => process.removeListener('SIGTERM', existing));
    cleanups.push(() => clearAutoFlush(state));

    scheduleAutoFlush(state, 30_000, flush, flush);
    process.emit('SIGTERM');

    expect(flush).toHaveBeenCalledTimes(1);
    expect(existing).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it('does not re-raise a termination signal a one-shot listener registered before the flush', () => {
    const state = createAutoFlushState();
    const flush = vi.fn();
    const existing = vi.fn();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    process.once('SIGTERM', existing);
    cleanups.push(() => process.removeListener('SIGTERM', existing));
    cleanups.push(() => clearAutoFlush(state));

    scheduleAutoFlush(state, 30_000, flush, flush);
    process.emit('SIGTERM');

    expect(existing).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it('flushes and re-raises once when auto-flush is the only termination listener', () => {
    const state = createAutoFlushState();
    const flush = vi.fn();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    cleanups.push(() => clearAutoFlush(state));

    scheduleAutoFlush(state, 30_000, flush, flush);
    process.emit('SIGINT');

    expect(flush).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
  });
});
