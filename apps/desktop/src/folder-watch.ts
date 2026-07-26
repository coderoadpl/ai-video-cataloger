import type { App } from '@server/src/create-app.js';

interface WatchSession {
  stop(): void;
}

export interface FolderWatchControllerDeps {
  desktopApp: Promise<App>;
  notify: (folderPath: string) => void;
}

export class FolderWatchController {
  private session: WatchSession | null = null;
  private generation = 0;

  constructor(private readonly deps: FolderWatchControllerDeps) {}

  async watch(folderPath: string): Promise<void> {
    this.stop();
    const generation = this.generation;
    const app = await this.deps.desktopApp;
    const started = await app.watchFolder(
      folderPath,
      () => this.deps.notify(folderPath),
      () => {
        if (generation === this.generation) this.session = null;
      },
    );
    if (!started.ok) return;
    if (generation !== this.generation) {
      started.value.stop();
      return;
    }
    this.session = started.value;
  }

  stop(): void {
    this.generation += 1;
    this.session?.stop();
    this.session = null;
  }
}
