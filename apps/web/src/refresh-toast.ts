export interface RefreshToast {
  readonly message: string;
}

let current: RefreshToast | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/**
 * Module-scope store for the single background-refresh error notice. The
 * QueryCache error surface writes to it from outside React; the snackbar
 * subscribes via `useSyncExternalStore`.
 */
export const refreshToastStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot(): RefreshToast | null {
    return current;
  },
  show(message: string): void {
    current = { message };
    emit();
  },
  dismiss(): void {
    if (current === null) return;
    current = null;
    emit();
  },
};
