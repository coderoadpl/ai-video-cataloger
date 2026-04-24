import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_RECENT_FOLDERS = 10;

interface FolderStoreData {
  currentFolder: string | null;
  recentFolders: string[];
}

function getStorePath(): string {
  return join(app.getPath('userData'), 'folder-store.json');
}

function loadStore(): FolderStoreData {
  const storePath = getStorePath();
  if (existsSync(storePath)) {
    try {
      const data = readFileSync(storePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      // Return default if parse fails
    }
  }
  return { currentFolder: null, recentFolders: [] };
}

function saveStore(data: FolderStoreData): void {
  const storePath = getStorePath();
  const dir = dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(storePath, JSON.stringify(data, null, 2));
}

/**
 * Get the current selected folder.
 */
export function getCurrentFolder(): string | null {
  return loadStore().currentFolder;
}

/**
 * Set the current selected folder and add to recent list.
 */
export function setCurrentFolder(folderPath: string): void {
  const store = loadStore();
  store.currentFolder = folderPath;

  // Add to recent folders, removing duplicates and limiting to max
  const recentFolders = [
    folderPath,
    ...store.recentFolders.filter((f) => f !== folderPath),
  ].slice(0, MAX_RECENT_FOLDERS);

  store.recentFolders = recentFolders;
  saveStore(store);
}

/**
 * Get the list of recent folders.
 */
export function getRecentFolders(): string[] {
  return loadStore().recentFolders;
}

/**
 * Remove a folder from the recent list.
 */
export function removeRecentFolder(folderPath: string): void {
  const store = loadStore();
  store.recentFolders = store.recentFolders.filter((f) => f !== folderPath);
  if (store.currentFolder === folderPath) {
    store.currentFolder = null;
  }
  saveStore(store);
}

/**
 * Clear all recent folders.
 */
export function clearRecentFolders(): void {
  const store = loadStore();
  store.recentFolders = [];
  store.currentFolder = null;
  saveStore(store);
}
