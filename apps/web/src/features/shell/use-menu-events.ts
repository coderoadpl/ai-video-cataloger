import { useEffect, useRef } from 'react';

import { bridge } from '../../api.js';

export interface MenuEventHandlers {
  onShowSettings: () => void;
  onShowModelManager: () => void;
  onShowPrerequisites: () => void;
  onToggleTerminal: () => void;
  onToggleSidebar: () => void;
}

/**
 * Subscribes to the native menu events that drive app chrome (open the
 * settings/models/prerequisites modals, toggle the terminal and sidebar) over
 * the desktop bridge (parity-inventory §3 menu channels). Handlers are held in a
 * ref so the subscriptions register once yet always call the latest closure; the
 * folder-related menu events live in `use-shell`.
 */
export const useMenuEvents = (handlers: MenuEventHandlers): void => {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const unsubscribers = [
      bridge.menu.on('showSettings', () => handlersRef.current.onShowSettings()),
      bridge.menu.on('showModelManager', () => handlersRef.current.onShowModelManager()),
      bridge.menu.on('showPrerequisites', () => handlersRef.current.onShowPrerequisites()),
      bridge.menu.on('toggleTerminal', () => handlersRef.current.onToggleTerminal()),
      bridge.menu.on('toggleSidebar', () => handlersRef.current.onToggleSidebar()),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);
};
