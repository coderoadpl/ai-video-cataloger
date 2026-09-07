import { useCallback, useEffect, useState } from 'react';

export interface MountGuard {
  isMounted: () => boolean;
  signal: () => AbortSignal;
}

interface MountGuardHandle extends MountGuard {
  attach: () => void;
  release: () => void;
}

const createMountGuard = (): MountGuardHandle => {
  let controller = new AbortController();
  return {
    isMounted: () => !controller.signal.aborted,
    signal: () => controller.signal,
    attach: () => {
      if (controller.signal.aborted) controller = new AbortController();
    },
    release: () => {
      controller.abort();
    },
  };
};

export const useMountGuard = (): MountGuard => {
  const [guard] = useState(createMountGuard);
  useEffect(() => {
    guard.attach();
    return guard.release;
  }, [guard]);
  return guard;
};

export const useGuardedCallback = <A extends readonly unknown[]>(
  guard: MountGuard,
  callback: (...args: A) => void,
): ((...args: A) => void) =>
  useCallback(
    (...args: A) => {
      if (guard.isMounted()) callback(...args);
    },
    [guard, callback],
  );
