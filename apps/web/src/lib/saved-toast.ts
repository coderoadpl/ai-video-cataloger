let current: string | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const savedToastStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot(): string | null {
    return current;
  },
  show(message: string): void {
    current = message;
    emit();
  },
  dismiss(): void {
    if (current === null) return;
    current = null;
    emit();
  },
};
