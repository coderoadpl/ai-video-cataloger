import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePhotosAutoScan, type UsePhotosAutoScanInput } from './use-photos-auto-scan.js';

const baseInput = (overrides: Partial<UsePhotosAutoScanInput> = {}): UsePhotosAutoScanInput => ({
  active: true,
  folder: '/movies',
  folderState: 'unscanned',
  isRootsReady: true,
  isBusy: false,
  scanFolder: vi.fn(),
  ...overrides,
});

describe('usePhotosAutoScan', () => {
  it('fires the scan once for a never-scanned folder as soon as roots are ready', () => {
    const scanFolder = vi.fn();
    renderHook((props: UsePhotosAutoScanInput) => usePhotosAutoScan(props), {
      initialProps: baseInput({ scanFolder }),
    });

    expect(scanFolder).toHaveBeenCalledTimes(1);
  });

  it('does not fire a second time on a re-render for the same folder', () => {
    const scanFolder = vi.fn();
    const { rerender } = renderHook((props: UsePhotosAutoScanInput) => usePhotosAutoScan(props), {
      initialProps: baseInput({ scanFolder }),
    });

    rerender(baseInput({ scanFolder, isBusy: true }));
    rerender(baseInput({ scanFolder, isBusy: false }));

    expect(scanFolder).toHaveBeenCalledTimes(1);
  });

  it('does not fire again after the tab toggles away and back to the same unscanned folder', () => {
    const scanFolder = vi.fn();
    const { rerender } = renderHook((props: UsePhotosAutoScanInput) => usePhotosAutoScan(props), {
      initialProps: baseInput({ scanFolder }),
    });

    rerender(baseInput({ scanFolder, active: false }));
    rerender(baseInput({ scanFolder, active: true }));

    expect(scanFolder).toHaveBeenCalledTimes(1);
  });

  it('fires again for a different folder once it too is unscanned', () => {
    const scanFolder = vi.fn();
    const { rerender } = renderHook((props: UsePhotosAutoScanInput) => usePhotosAutoScan(props), {
      initialProps: baseInput({ scanFolder, folder: '/a' }),
    });

    rerender(baseInput({ scanFolder, folder: '/b' }));

    expect(scanFolder).toHaveBeenCalledTimes(2);
  });

  it('does not fire while roots are still loading', () => {
    const scanFolder = vi.fn();
    renderHook((props: UsePhotosAutoScanInput) => usePhotosAutoScan(props), {
      initialProps: baseInput({ scanFolder, isRootsReady: false }),
    });

    expect(scanFolder).not.toHaveBeenCalled();
  });

  it('does not fire for an already-scanned folder', () => {
    const scanFolder = vi.fn();
    renderHook((props: UsePhotosAutoScanInput) => usePhotosAutoScan(props), {
      initialProps: baseInput({ scanFolder, folderState: 'scanned' }),
    });

    expect(scanFolder).not.toHaveBeenCalled();
  });

  it('does not fire while a scan/analyze job is already busy', () => {
    const scanFolder = vi.fn();
    renderHook((props: UsePhotosAutoScanInput) => usePhotosAutoScan(props), {
      initialProps: baseInput({ scanFolder, isBusy: true }),
    });

    expect(scanFolder).not.toHaveBeenCalled();
  });

  it('does not fire when there is no current folder', () => {
    const scanFolder = vi.fn();
    renderHook((props: UsePhotosAutoScanInput) => usePhotosAutoScan(props), {
      initialProps: baseInput({ scanFolder, folder: null }),
    });

    expect(scanFolder).not.toHaveBeenCalled();
  });
});
