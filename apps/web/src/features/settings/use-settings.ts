import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import {
  changedKeys,
  draftFromStored,
  serializeValue,
  type LocalAiTier,
  type SettingsDraft,
} from './settings-model.js';

export interface SettingsState {
  isLoading: boolean;
  error: string | null;
  draft: SettingsDraft | null;
  hasChanges: boolean;
  isSaving: boolean;
  tiers: LocalAiTier[] | null;
  setDraft: (patch: Partial<SettingsDraft>) => void;
  save: () => void;
  reset: () => void;
}

export interface UseSettingsOptions {
  open: boolean;
  folder: string | null;
  onSaved?: () => void;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const useSettings = ({ open, folder, onSaved }: UseSettingsOptions): SettingsState => {
  const enabled = open && folder !== null;
  const configQuery = useQuery({ ...actions.config(folder === null ? {} : { folder }), enabled });
  const requirementsQuery = useQuery({ ...actions.localAiRequirements, enabled });
  const setConfig = useMutation(actions.setConfig);

  const [draft, setDraftState] = useState<SettingsDraft | null>(null);
  const [original, setOriginal] = useState<SettingsDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const data = configQuery.data;
  useEffect(() => {
    if (!open) {
      setDraftState(null);
      setOriginal(null);
      setSaveError(null);
      return;
    }
    if (draft !== null || data === undefined || !('config' in data)) return;
    const seeded = draftFromStored(data.config, data.defaults);
    setDraftState(seeded);
    setOriginal(seeded);
  }, [open, data, draft]);

  const setDraft = useCallback((patch: Partial<SettingsDraft>) => {
    setDraftState((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setDraftState(original);
    setSaveError(null);
  }, [original]);

  const save = useCallback(() => {
    if (draft === null || original === null || folder === null) return;
    const keys = changedKeys(draft, original);
    if (keys.length === 0) return;
    void (async () => {
      setIsSaving(true);
      setSaveError(null);
      let allOk = true;
      for (const key of keys) {
        try {
          await setConfig.mutateAsync({ folder, key, value: serializeValue(draft, key) });
        } catch (error) {
          allOk = false;
          setSaveError(messageOf(error));
        }
      }
      setIsSaving(false);
      if (!allOk) return;
      setOriginal(draft);
      await configQuery.refetch();
      onSaved?.();
    })();
  }, [draft, original, folder, setConfig, configQuery, onSaved]);

  const hasChanges =
    draft !== null && original !== null && changedKeys(draft, original).length > 0;

  return {
    isLoading: enabled && draft === null && configQuery.error === null,
    error: saveError ?? (configQuery.error === null ? null : messageOf(configQuery.error)),
    draft,
    hasChanges,
    isSaving,
    tiers: requirementsQuery.data?.tiers ?? null,
    setDraft,
    save,
    reset,
  };
};
