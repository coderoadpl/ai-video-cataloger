/**
 * useMenuEvents - subscribe to native menu events from the main process and
 * dispatch them to App-level handlers. Extracted from App.
 *
 * Handlers are kept in a ref so the subscriptions are registered once and
 * always call the latest handler (observable behavior is identical to the
 * original resubscribe-on-change effect).
 */

import { useEffect, useRef } from 'react';

export interface MenuEventHandlers {
  onOpenFolder: () => void;
  onOpenRecentFolder: (folderPath: string) => void;
  onClearRecentFolders: () => void | Promise<void>;
  onToggleTerminal: () => void;
  onToggleSidebar: () => void;
  onShowSettings: () => void;
  onShowPrerequisites: () => void;
  onShowModelManager: () => void;
}

export function useMenuEvents(handlers: MenuEventHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Listen for menu events from main process
  useEffect(() => {
    const cleanupOpenFolder = window.menuAPI?.onOpenFolder(() => {
      handlersRef.current.onOpenFolder();
    });

    const cleanupOpenRecentFolder = window.menuAPI?.onOpenRecentFolder((folderPath: string) => {
      handlersRef.current.onOpenRecentFolder(folderPath);
    });

    const cleanupClearRecentFolders = window.menuAPI?.onClearRecentFolders(() => {
      void handlersRef.current.onClearRecentFolders();
    });

    const cleanupToggleTerminal = window.menuAPI?.onToggleTerminal(() => {
      handlersRef.current.onToggleTerminal();
    });

    const cleanupToggleSidebar = window.menuAPI?.onToggleSidebar(() => {
      handlersRef.current.onToggleSidebar();
    });

    const cleanupShowSettings = window.menuAPI?.onShowSettings(() => {
      handlersRef.current.onShowSettings();
    });

    const cleanupShowPrerequisites = window.menuAPI?.onShowPrerequisites(() => {
      handlersRef.current.onShowPrerequisites();
    });

    const cleanupShowModelManager = window.menuAPI?.onShowModelManager(() => {
      handlersRef.current.onShowModelManager();
    });

    return () => {
      cleanupOpenFolder?.();
      cleanupOpenRecentFolder?.();
      cleanupClearRecentFolders?.();
      cleanupToggleTerminal?.();
      cleanupToggleSidebar?.();
      cleanupShowSettings?.();
      cleanupShowPrerequisites?.();
      cleanupShowModelManager?.();
    };
  }, []);
}
