import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FolderChangedHandler } from '@core/contract/index.js';

import { bridge } from '../../api.js';
import { renderWithProviders } from '../../test/render.js';
import { useFolderWatch } from './use-folder-watch.js';

const Harness = ({ folder }: { folder: string | null }) => {
  useFolderWatch(folder);
  return null;
};

afterEach(() => {
  vi.restoreAllMocks();
});

const captureHandler = () => {
  const handlers: FolderChangedHandler[] = [];
  const unsubscribe = vi.fn();
  vi.spyOn(bridge.folder, 'onChanged').mockImplementation((handler) => {
    handlers.push(handler);
    return unsubscribe;
  });
  return { handlers, unsubscribe };
};

describe('useFolderWatch', () => {
  it('invalidates the catalog queries when the watched folder changes on disk', async () => {
    const subscription = captureHandler();
    const { queryClient } = renderWithProviders(<Harness folder="/drive" />);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      subscription.handlers[0]?.({ folderPath: '/drive' });
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('ignores changes reported for another folder', async () => {
    const subscription = captureHandler();
    const { queryClient } = renderWithProviders(<Harness folder="/drive" />);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      subscription.handlers[0]?.({ folderPath: '/elsewhere' });
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not subscribe until a folder is open', () => {
    const subscription = captureHandler();
    renderWithProviders(<Harness folder={null} />).unmount();

    expect(subscription.handlers).toHaveLength(0);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it('unsubscribes on teardown', () => {
    const subscription = captureHandler();
    renderWithProviders(<Harness folder="/drive" />).unmount();

    expect(subscription.handlers).toHaveLength(1);
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
