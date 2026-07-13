import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const MAX_RECENT_FOLDERS = 10;

const folderStoreSchema = z.object({
  currentFolder: z.string().nullable(),
  recentFolders: z.array(z.string()),
});

export type FolderStoreData = z.infer<typeof folderStoreSchema>;

export const defaultFolderStore = (): FolderStoreData => ({
  currentFolder: null,
  recentFolders: [],
});

export class FolderStore {
  constructor(private readonly storePath: string) {}

  async getCurrent(): Promise<string | null> {
    return (await this.load()).currentFolder;
  }

  async setCurrent(folderPath: string): Promise<void> {
    const store = await this.load();
    await this.save({
      currentFolder: folderPath,
      recentFolders: trimRecentFolders([folderPath, ...store.recentFolders]),
    });
  }

  async getRecent(): Promise<string[]> {
    return (await this.load()).recentFolders;
  }

  async removeRecent(folderPath: string): Promise<void> {
    const store = await this.load();
    await this.save({
      currentFolder: store.currentFolder === folderPath ? null : store.currentFolder,
      recentFolders: store.recentFolders.filter((recent) => recent !== folderPath),
    });
  }

  async clearRecent(): Promise<void> {
    await this.save(defaultFolderStore());
  }

  private async load(): Promise<FolderStoreData> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      const parsed = folderStoreSchema.safeParse(JSON.parse(raw));
      return parsed.success ? normalizeFolderStore(parsed.data) : defaultFolderStore();
    } catch {
      return defaultFolderStore();
    }
  }

  private async save(data: FolderStoreData): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(normalizeFolderStore(data), null, 2), 'utf8');
  }
}

export const folderStorePath = (userDataPath: string): string => path.join(userDataPath, 'folder-store.json');

export const normalizeFolderStore = (data: FolderStoreData): FolderStoreData => ({
  currentFolder: data.currentFolder,
  recentFolders: trimRecentFolders(data.recentFolders),
});

export const trimRecentFolders = (folders: readonly string[]): string[] => {
  const result: string[] = [];
  for (const folder of folders) {
    if (!result.includes(folder)) result.push(folder);
    if (result.length === MAX_RECENT_FOLDERS) break;
  }
  return result;
};
