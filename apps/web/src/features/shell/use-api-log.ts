import { useMemo, useSyncExternalStore } from 'react';

import { apiLogStore, type ApiLogEntry } from '../../api-log.js';
import type { LogLine } from '../../components/ui/use-terminal-log.js';

export interface ApiLogState {
  lines: readonly LogLine[];
  clear: () => void;
}

const requestLine = (entry: ApiLogEntry, method: string, url: string): LogLine => {
  const content = `→ ${method} ${url}`;
  return {
    id: entry.id,
    at: entry.at,
    content,
    type: 'stdout',
    raw: entry.body === null ? null : `${content}\n${entry.body}`,
  };
};

const responseLine = (entry: ApiLogEntry, method: string, url: string): LogLine => {
  const content = `← ${String(entry.status)} ${method} ${url} (${String(entry.durationMs)}ms)`;
  return {
    id: entry.id,
    at: entry.at,
    content,
    type: (entry.status ?? 0) >= 400 ? 'error' : 'info',
    raw: entry.body === null ? null : `${content}\n${entry.body}`,
  };
};

const errorLine = (entry: ApiLogEntry, method: string, url: string): LogLine => {
  const content = `× ${method} ${url} — ${entry.body ?? ''}`;
  return { id: entry.id, at: entry.at, content, type: 'error', raw: content };
};

export const apiLogLine = (entry: ApiLogEntry): LogLine => {
  switch (entry.direction) {
    case 'request':
      return requestLine(entry, entry.method, entry.url);
    case 'response':
      return responseLine(entry, entry.method, entry.url);
    case 'error':
      return errorLine(entry, entry.method, entry.url);
  }
};

export const useApiLog = (): ApiLogState => {
  const entries = useSyncExternalStore(apiLogStore.subscribe, apiLogStore.snapshot);
  const lines = useMemo(() => entries.map(apiLogLine), [entries]);
  return { lines, clear: apiLogStore.clear };
};
