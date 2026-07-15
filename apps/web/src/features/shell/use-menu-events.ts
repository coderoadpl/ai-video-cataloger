import { useEffect, useRef } from 'react';

import { bridge } from '../../api.js';

export interface MenuEventHandlers {
  onShowSettings: () => void;
  onShowModelManager: () => void;
  onShowPrerequisites: () => void;
  onShowSetupWizard: () => void;
  onToggleTerminal: () => void;
  onToggleSidebar: () => void;
}

export const useMenuEvents = (handlers: MenuEventHandlers): void => {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const unsubscribers = [
      bridge.menu.on('showSettings', () => handlersRef.current.onShowSettings()),
      bridge.menu.on('showModelManager', () => handlersRef.current.onShowModelManager()),
      bridge.menu.on('showPrerequisites', () => handlersRef.current.onShowPrerequisites()),
      bridge.menu.on('showSetupWizard', () => handlersRef.current.onShowSetupWizard()),
      bridge.menu.on('toggleTerminal', () => handlersRef.current.onToggleTerminal()),
      bridge.menu.on('toggleSidebar', () => handlersRef.current.onToggleSidebar()),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);
};
