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

const onBeforeExit = (): void => runExitFlushes();
const onExit = (): void => runExitFlushes();
const onSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
  runExitFlushes();
  removeProcessHooks();
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
};
const onSigInt = (): void => onSignal('SIGINT');
const onSigTerm = (): void => onSignal('SIGTERM');

const ensureProcessHooks = (): void => {
  if (processHooksRegistered) return;
  processHooksRegistered = true;
  process.once('beforeExit', onBeforeExit);
  process.once('exit', onExit);
  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);
};

const removeProcessHooks = (): void => {
  if (!processHooksRegistered) return;
  process.removeListener('beforeExit', onBeforeExit);
  process.removeListener('exit', onExit);
  process.removeListener('SIGINT', onSigInt);
  process.removeListener('SIGTERM', onSigTerm);
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
