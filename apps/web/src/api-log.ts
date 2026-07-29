export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const API_LOG_MAX_ENTRIES = 500;
export const API_LOG_MAX_BODY_CHARS = 10_000;

export type ApiLogDirection = 'request' | 'response' | 'error';

export interface ApiLogEntry {
  id: string;
  requestId: string;
  at: number;
  direction: ApiLogDirection;
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  body: string | null;
}

export const appendApiEntry = (
  entries: readonly ApiLogEntry[],
  entry: ApiLogEntry,
  max: number,
): readonly ApiLogEntry[] => {
  const next = [...entries, entry];
  return next.length > max ? next.slice(next.length - max) : next;
};

let entries: readonly ApiLogEntry[] = [];
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const apiLogStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot(): readonly ApiLogEntry[] {
    return entries;
  },
  record(entry: ApiLogEntry): void {
    entries = appendApiEntry(entries, entry, API_LOG_MAX_ENTRIES);
    emit();
  },
  clear(): void {
    if (entries.length === 0) return;
    entries = [];
    emit();
  },
};

const truncate = (text: string): string =>
  text.length <= API_LOG_MAX_BODY_CHARS ? text : `${text.slice(0, API_LOG_MAX_BODY_CHARS)}…`;

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const REDACTED_BODY_ROUTES = ['/api/credentials'];

const isRedactedRoute = (url: string): boolean =>
  REDACTED_BODY_ROUTES.some((route) => new URL(url, 'http://localhost').pathname === route);

const requestBodyFor = (url: string, body: RequestInit['body']): string | null => {
  if (typeof body !== 'string') return null;
  return isRedactedRoute(url) ? '[redacted]' : truncate(body);
};

let requestCounter = 0;
const nextRequestId = (): string => {
  requestCounter += 1;
  return `api-${String(requestCounter)}`;
};

export const instrumentFetch = (fetchImpl: FetchLike): FetchLike => async (input, init) => {
  const requestId = nextRequestId();
  const method = init?.method ?? 'GET';
  const url = urlOf(input);
  const startedAt = Date.now();
  apiLogStore.record({
    id: `${requestId}-req`,
    requestId,
    at: startedAt,
    direction: 'request',
    method,
    url,
    status: null,
    durationMs: null,
    body: requestBodyFor(url, init?.body),
  });

  let response: Response;
  try {
    response = await fetchImpl(input, init);
  } catch (cause) {
    apiLogStore.record({
      id: `${requestId}-err`,
      requestId,
      at: Date.now(),
      direction: 'error',
      method,
      url,
      status: null,
      durationMs: Date.now() - startedAt,
      body: String(cause),
    });
    throw cause;
  }

  let body: string | null = null;
  try {
    body = truncate(await response.clone().text());
  } catch {
    body = null;
  }
  apiLogStore.record({
    id: `${requestId}-res`,
    requestId,
    at: Date.now(),
    direction: 'response',
    method,
    url,
    status: response.status,
    durationMs: Date.now() - startedAt,
    body,
  });

  return response;
};
