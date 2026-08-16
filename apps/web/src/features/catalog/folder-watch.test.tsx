import { useState } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FolderChangedHandler } from '@core/contract/index.js';

import { bridge } from '../../api.js';
import { renderWithProviders } from '../../test/render.js';
import { useFolderWatch } from './use-folder-watch.js';

interface HarnessProps {
  folder: string | null;
  photosActive?: boolean;
  photosBusy?: boolean;
  scanPhotos?: () => Promise<boolean>;
}

const Harness = ({ folder, photosActive = false, photosBusy = false, scanPhotos = () => Promise.resolve(true) }: HarnessProps) => {
  useFolderWatch(folder, { photosActive, photosBusy, scanPhotos });
  return null;
};

const BusyHarness = ({ scanPhotos }: { scanPhotos: () => Promise<boolean> }) => {
  const [photosBusy, setPhotosBusy] = useState(true);
  useFolderWatch('/drive', { photosActive: true, photosBusy, scanPhotos });
  return <button onClick={() => setPhotosBusy(false)}>Settle photo job</button>;
};

const RetryHarness = ({ scanPhotos }: { scanPhotos: () => Promise<boolean> }) => {
  const [photosBusy, setPhotosBusy] = useState(false);
  useFolderWatch('/drive', { photosActive: true, photosBusy, scanPhotos });
  return (
    <>
      <button onClick={() => setPhotosBusy(true)}>Start photo job</button>
      <button onClick={() => setPhotosBusy(false)}>Settle photo job</button>
    </>
  );
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

  it('rescans photos when the current watched folder changes in photos mode', async () => {
    const subscription = captureHandler();
    const scanPhotos = vi.fn().mockResolvedValue(true);
    renderWithProviders(<Harness folder="/drive" photosActive scanPhotos={scanPhotos} />);

    await act(async () => {
      subscription.handlers[0]?.({ folderPath: '/drive' });
    });

    expect(scanPhotos).toHaveBeenCalledTimes(1);
  });

  it('holds a pending photo rescan until the active photo job settles', async () => {
    const subscription = captureHandler();
    const scanPhotos = vi.fn().mockResolvedValue(true);
    renderWithProviders(<BusyHarness scanPhotos={scanPhotos} />);

    await act(async () => {
      subscription.handlers[0]?.({ folderPath: '/drive' });
    });
    expect(scanPhotos).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Settle photo job' }));

    expect(scanPhotos).toHaveBeenCalledTimes(1);
  });

  it('retries one failed watched-folder scan without requiring another filesystem event', async () => {
    vi.useFakeTimers();
    const subscription = captureHandler();
    const scanPhotos = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderWithProviders(<RetryHarness scanPhotos={scanPhotos} />);

    await act(async () => {
      subscription.handlers[0]?.({ folderPath: '/drive' });
      await Promise.resolve();
    });
    expect(scanPhotos).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Start photo job' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle photo job' }));
    expect(scanPhotos).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(scanPhotos).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(scanPhotos).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('ignores changes reported for another folder', async () => {
    const subscription = captureHandler();
    const scanPhotos = vi.fn().mockResolvedValue(true);
    const { queryClient } = renderWithProviders(
      <Harness folder="/drive" photosActive scanPhotos={scanPhotos} />,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      subscription.handlers[0]?.({ folderPath: '/elsewhere' });
    });

    expect(invalidate).not.toHaveBeenCalled();
    expect(scanPhotos).not.toHaveBeenCalled();
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
