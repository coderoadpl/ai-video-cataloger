import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';
import { CONFIG_KEYS } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { savedToastStore } from '../../lib/saved-toast.js';
import {
  changedKeys,
  draftFromEffective,
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
  apiCredential: string;
  whisperApiCredential: string;
  inherited: string[];
  setApiCredential: (credential: string) => void;
  setWhisperApiCredential: (credential: string) => void;
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
  const dictionary = useDictionary();
  const enabled = open && folder !== null;
  const queryClient = useQueryClient();
  const configQuery = useQuery({ ...actions.config(folder === null ? {} : { folder }), enabled });
  const requirementsQuery = useQuery({ ...actions.localAiRequirements, enabled });
  const setConfig = useMutation(actions.setConfig);
  const setCredential = useMutation(actions.setCredential);

  const [draft, setDraftState] = useState<SettingsDraft | null>(null);
  const [original, setOriginal] = useState<SettingsDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiCredential, setApiCredential] = useState('');
  const [whisperApiCredential, setWhisperApiCredential] = useState('');

  const data = configQuery.data;
  useEffect(() => {
    if (!open) {
      setDraftState(null);
      setOriginal(null);
      setSaveError(null);
      setApiCredential('');
      setWhisperApiCredential('');
      return;
    }
    if (draft !== null || data === undefined || !('config' in data)) return;
    const seeded = draftFromEffective(data.effective);
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
    if (keys.length === 0 && apiCredential.length === 0 && whisperApiCredential.length === 0) return;
    void (async () => {
      setIsSaving(true);
      setSaveError(null);
      let allOk = true;
      for (const key of keys) {
        try {
          await setConfig.mutateAsync({
            ...(key === 'faces_enabled' || key === 'ui_language' ? {} : { folder }),
            key,
            value: serializeValue(draft, key),
          });
        } catch (error) {
          allOk = false;
          setSaveError(messageOf(error));
        }
      }
      if (
        apiCredential.length > 0
        && (draft.analyzer_provider.family === 'api' || draft.analyzer_provider.family === 'gemini-native')
      ) {
        try {
          await setCredential.mutateAsync({
            providerId: draft.analyzer_provider.apiKeyRef,
            credential: apiCredential,
          });
          setApiCredential('');
        } catch (error) {
          allOk = false;
          setSaveError(messageOf(error));
        }
      }
      if (whisperApiCredential.length > 0 && draft.whisper_mode === 'api') {
        try {
          await setCredential.mutateAsync({ providerId: 'openai', credential: whisperApiCredential });
          setWhisperApiCredential('');
        } catch (error) {
          allOk = false;
          setSaveError(messageOf(error));
        }
      }
      setIsSaving(false);
      if (!allOk) return;
      setOriginal(draft);
      await configQuery.refetch();
      await queryClient.invalidateQueries();
      savedToastStore.show(dictionary.settings.savedToast);
      onSaved?.();
    })();
  }, [
    apiCredential,
    configQuery,
    dictionary,
    draft,
    folder,
    onSaved,
    original,
    queryClient,
    setConfig,
    setCredential,
    whisperApiCredential,
  ]);

  const hasChanges =
    draft !== null && original !== null && (
      changedKeys(draft, original).length > 0
      || apiCredential.length > 0
      || whisperApiCredential.length > 0
    );

  return {
    isLoading: enabled && draft === null && configQuery.error === null,
    error: saveError ?? (configQuery.error === null ? null : messageOf(configQuery.error)),
    draft,
    hasChanges,
    isSaving,
    tiers: requirementsQuery.data?.tiers ?? null,
    apiCredential,
    whisperApiCredential,
    inherited: data !== undefined && 'config' in data
      ? CONFIG_KEYS
        .filter((key) => data.sources[key] !== 'folder')
        .map((key) => `${key}: ${data.effective[key]} (${data.sources[key]})`)
      : [],
    setApiCredential,
    setWhisperApiCredential,
    setDraft,
    save,
    reset,
  };
};
