import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStorageItem, removeStorageItem, writeStorageItem } from './persistent-storage.js';

const throwingStorage = (method: 'getItem' | 'setItem' | 'removeItem'): Storage => {
  const boom = (): never => {
    throw new Error('blocked');
  };
  return {
    length: 0,
    clear: () => {},
    key: () => null,
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    [method]: boom,
  };
};

describe('persistent-storage', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('reads and writes local storage under a key', () => {
    writeStorageItem('local', 'k', 'v');
    expect(readStorageItem('local', 'k')).toBe('v');
  });

  it('reads and writes session storage under a key', () => {
    writeStorageItem('session', 'k', 'v');
    expect(readStorageItem('session', 'k')).toBe('v');
    expect(readStorageItem('local', 'k')).toBeNull();
  });

  it('removes an item', () => {
    writeStorageItem('local', 'k', 'v');
    removeStorageItem('local', 'k');
    expect(readStorageItem('local', 'k')).toBeNull();
  });

  it('returns null for a missing key', () => {
    expect(readStorageItem('local', 'missing')).toBeNull();
  });

  it('returns null instead of throwing when the storage getter throws', () => {
    vi.stubGlobal('localStorage', throwingStorage('getItem'));
    expect(readStorageItem('local', 'k')).toBeNull();
  });

  it('swallows a write failure instead of throwing', () => {
    vi.stubGlobal('localStorage', throwingStorage('setItem'));
    expect(() => writeStorageItem('local', 'k', 'v')).not.toThrow();
  });

  it('swallows a remove failure instead of throwing', () => {
    vi.stubGlobal('localStorage', throwingStorage('removeItem'));
    expect(() => removeStorageItem('local', 'k')).not.toThrow();
  });
});
