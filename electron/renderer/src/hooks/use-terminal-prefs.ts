/**
 * useTerminalPrefs - persisted UI preferences for the terminal panel
 * (collapsed state, panel size, JSON visibility), extracted from App.
 */

import { useCallback, useEffect, useState } from 'react';
import { TERMINAL_DEFAULT_SIZE } from '@/components/layout';

// LocalStorage keys for persisting UI state
const STORAGE_KEY_TERMINAL_COLLAPSED = 'ai-video-cataloger:terminal-collapsed';
const STORAGE_KEY_TERMINAL_SIZE = 'ai-video-cataloger:terminal-size';

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV;

export interface UseTerminalPrefsResult {
  terminalCollapsed: boolean;
  setTerminalCollapsed: (collapsed: boolean) => void;
  toggleTerminalCollapsed: () => void;
  terminalSize: number;
  setTerminalSize: (size: number) => void;
  showJson: boolean;
  setShowJson: (show: boolean) => void;
}

export function useTerminalPrefs(): UseTerminalPrefsResult {
  // Terminal collapsed: default to collapsed in production, open in development
  // Also check localStorage for user preference
  const [terminalCollapsed, setTerminalCollapsedState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY_TERMINAL_COLLAPSED);
    if (stored !== null) {
      return stored === 'true';
    }
    // Default: collapsed in production, open in development
    return !isDevelopment;
  });

  // Terminal size from localStorage
  const [terminalSize, setTerminalSize] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY_TERMINAL_SIZE);
    if (stored !== null) {
      const size = parseInt(stored, 10);
      if (!isNaN(size)) {
        return size;
      }
    }
    return TERMINAL_DEFAULT_SIZE;
  });

  const [showJson, setShowJson] = useState(false);

  // Save terminal collapsed state to localStorage
  const setTerminalCollapsed = useCallback((collapsed: boolean) => {
    setTerminalCollapsedState(collapsed);
    localStorage.setItem(STORAGE_KEY_TERMINAL_COLLAPSED, String(collapsed));
  }, []);

  // Toggle used by the View menu
  const toggleTerminalCollapsed = useCallback(() => {
    setTerminalCollapsedState((prev) => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEY_TERMINAL_COLLAPSED, String(newValue));
      return newValue;
    });
  }, []);

  // Debounce saving terminal size to avoid too many writes
  useEffect(() => {
    const timeout = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY_TERMINAL_SIZE, String(terminalSize));
    }, 300);
    return () => clearTimeout(timeout);
  }, [terminalSize]);

  return {
    terminalCollapsed,
    setTerminalCollapsed,
    toggleTerminalCollapsed,
    terminalSize,
    setTerminalSize,
    showJson,
    setShowJson,
  };
}
