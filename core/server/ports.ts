/**
 * Ports: interfaces the core depends on, implemented in `adapters/`. The
 * foundation's `Clock` and `IdGenerator` seed the set; every real port
 * (CatalogRepository, MediaPort, TranscriberPort, …) lands in later stories.
 */

export interface Clock {
  nowIso(): string;
}

export interface IdGenerator {
  nextId(): string;
}
