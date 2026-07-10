/**
 * useLocalAiModels - local AI tier/requirements state for the GUI, driven
 * entirely by CLI --json commands (models requirements / pull / rm).
 */

import { useCallback, useState } from 'react';
import type { RunCli } from '@/hooks/use-cli-command';

export interface LocalAiMachine {
  platform: string;
  arch: string;
  totalMemGB: number;
  appleSilicon: boolean;
}

export interface LocalAiTier {
  tag: string;
  label: string;
  downloadGB: number;
  minTotalMemGB: number;
  supportLevel: 'ok' | 'insufficient-ram' | 'unsupported-platform';
  installed: boolean;
  recommended: boolean;
}

export interface LocalAiState {
  machine: LocalAiMachine | null;
  tiers: LocalAiTier[] | null;
  runtimeUp: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface UseLocalAiModelsResult extends LocalAiState {
  refresh: () => Promise<void>;
  /** Pull a model; onPercent receives 0-100 progress updates. */
  pull: (tag: string, onPercent: (percent: number) => void) => Promise<boolean>;
  remove: (tag: string) => Promise<boolean>;
}

export function useLocalAiModels(runCli: RunCli): UseLocalAiModelsResult {
  const [state, setState] = useState<LocalAiState>({
    machine: null,
    tiers: null,
    runtimeUp: false,
    isLoading: false,
    error: null,
  });

  const refresh = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const { code, events } = await runCli(['models', 'requirements', '--json'], {});
      const completed = events.find((event) => event.type === 'completed' && event.data);
      if (code !== 0 || !completed?.data) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Failed to load local AI models' }));
        return;
      }
      const data = completed.data as unknown as {
        machine: LocalAiMachine;
        runtimeUp: boolean;
        tiers: LocalAiTier[];
      };
      setState({
        machine: data.machine,
        tiers: data.tiers,
        runtimeUp: data.runtimeUp,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
    }
  }, [runCli]);

  const pull = useCallback(
    async (tag: string, onPercent: (percent: number) => void): Promise<boolean> => {
      try {
        const { code, events } = await runCli(['models', 'pull', tag, '--json'], {
          onJson: (event) => {
            if (event.type === 'progress' && typeof event.percentage === 'number') {
              onPercent(event.percentage);
            }
          },
        });
        const completed = events.some((event) => event.type === 'completed');
        return code === 0 && completed;
      } catch {
        return false;
      }
    },
    [runCli]
  );

  const remove = useCallback(
    async (tag: string): Promise<boolean> => {
      try {
        const { code, events } = await runCli(['models', 'rm', tag, '--json'], {});
        return code === 0 && events.some((event) => event.type === 'completed');
      } catch {
        return false;
      }
    },
    [runCli]
  );

  return { ...state, refresh, pull, remove };
}
