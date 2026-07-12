export interface AppDeps {
  version: string;
}

export interface AppConfig {
  version?: string;
}

/**
 * Composition root — the only place where config decides which adapters run.
 * The health slice needs none yet; real ports (repositories, media, jobs) are
 * wired here in later stories.
 */
export const createDeps = (config: AppConfig = {}): AppDeps => ({
  version: config.version ?? '0.1.0',
});
