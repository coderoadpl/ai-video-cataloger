import { useCallback, useEffect, useState } from 'react';

import { bridge } from '../../api.js';

export interface FirstLaunchState {
  shouldAutoOpen: boolean;
  markSeen: () => void;
}

export const useFirstLaunch = (): FirstLaunchState => {
  const [shouldAutoOpen, setShouldAutoOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void bridge.onboarding.getCompleted().then((completed) => {
      if (active && !completed) setShouldAutoOpen(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const markSeen = useCallback(() => {
    setShouldAutoOpen(false);
    void bridge.onboarding.setCompleted();
  }, []);

  return { shouldAutoOpen, markSeen };
};
