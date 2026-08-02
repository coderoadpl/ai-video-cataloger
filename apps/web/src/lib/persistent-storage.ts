export type StorageArea = 'local' | 'session';

const resolveStorage = (area: StorageArea): Storage | null => {
  if (typeof window === 'undefined') return null;
  const storage = area === 'local' ? window.localStorage : window.sessionStorage;
  return typeof storage?.getItem === 'function' ? storage : null;
};

// Every export below swallows a storage exception (private-browsing quota, a
// disabled storage API): losing one preference read/write is not fatal.
export const readStorageItem = (area: StorageArea, key: string): string | null => {
  try {
    return resolveStorage(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export const writeStorageItem = (area: StorageArea, key: string, value: string): void => {
  try {
    resolveStorage(area)?.setItem(key, value);
  } catch {
    return;
  }
};

export const removeStorageItem = (area: StorageArea, key: string): void => {
  try {
    resolveStorage(area)?.removeItem(key);
  } catch {
    return;
  }
};
