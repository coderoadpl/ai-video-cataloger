type FlushCallback = () => void;
type TimeoutHandle = ReturnType<typeof setTimeout>;

interface AutoFlushState {
  timer: TimeoutHandle | null;
  unregisterExitFlush: (() => void) | null;
}

const activeExitFlushes = new Set<FlushCallback>();
let processHooksRegistered = false;

const runExitFlushes = (): void => {
  for (const flush of [...activeExitFlushes]) flush();
};

type TerminationSignal = 'SIGINT' | 'SIGTERM';

const TERMINATION_SIGNALS: readonly TerminationSignal[] = ['SIGINT', 'SIGTERM'];
const ownedSignals = new Set<TerminationSignal>();

const onBeforeExit = (): void => runExitFlushes();
const onExit = (): void => runExitFlushes();
const onSignal = (signal: TerminationSignal): void => {
  runExitFlushes();
  const owned = ownedSignals.has(signal);
  removeProcessHooks();
  if (owned && process.listenerCount(signal) === 0) process.kill(process.pid, signal);
};
const signalHandlers: Record<TerminationSignal, () => void> = {
  SIGINT: () => onSignal('SIGINT'),
  SIGTERM: () => onSignal('SIGTERM'),
};

const ensureProcessHooks = (): void => {
  if (processHooksRegistered) return;
  processHooksRegistered = true;
  process.once('beforeExit', onBeforeExit);
  process.once('exit', onExit);
  for (const signal of TERMINATION_SIGNALS) {
    if (process.listenerCount(signal) === 0) ownedSignals.add(signal);
    process.on(signal, signalHandlers[signal]);
  }
};

const removeProcessHooks = (): void => {
  if (!processHooksRegistered) return;
  process.removeListener('beforeExit', onBeforeExit);
  process.removeListener('exit', onExit);
  for (const signal of TERMINATION_SIGNALS) process.removeListener(signal, signalHandlers[signal]);
  ownedSignals.clear();
  processHooksRegistered = false;
};

const registerExitFlush = (flush: FlushCallback): (() => void) => {
  activeExitFlushes.add(flush);
  ensureProcessHooks();
  return () => {
    activeExitFlushes.delete(flush);
    if (activeExitFlushes.size === 0) removeProcessHooks();
  };
};

const unrefTimer = (timer: TimeoutHandle): void => {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
};

export const createAutoFlushState = (): AutoFlushState => ({
  timer: null,
  unregisterExitFlush: null,
});

export const scheduleAutoFlush = (
  state: AutoFlushState,
  delayMs: number,
  flush: FlushCallback,
  flushOnExit: FlushCallback,
): void => {
  if (state.timer !== null) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    flush();
  }, delayMs);
  unrefTimer(state.timer);
  state.unregisterExitFlush ??= registerExitFlush(flushOnExit);
};

export const clearAutoFlush = (state: AutoFlushState): void => {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.unregisterExitFlush?.();
  state.unregisterExitFlush = null;
};
