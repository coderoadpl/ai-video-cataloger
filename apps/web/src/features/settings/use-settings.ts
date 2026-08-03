import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { IndexStatusOutput } from '@core/client/index.js';
import type { CredentialsBackendStatus } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { apiErrorMessage } from '../../i18n/api-error-message.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { savedToastStore } from '../../lib/saved-toast.js';
import {
  analyzerCredentialRef,
  changedKeys,
  credentialDeletionNotice,
  credentialSavedMessage,
  draftFromEffective,
  formatBudgetInput,
  parseBudgetInput,
  serializeValue,
  type CredentialNotice,
  type LocalAiTier,
  type SettingsDraft,
} from './settings-model.js';

export const SLOW_SAVE_HINT_MS = 2000;

type MonthlySpend = IndexStatusOutput['currentMonthSpend'];

export interface SettingsState {
  isLoading: boolean;
  error: string | null;
  draft: SettingsDraft | null;
  hasChanges: boolean;
  canSave: boolean;
  isSaving: boolean;
  isSaveSlow: boolean;
  tiers: LocalAiTier[] | null;
  apiCredential: string;
  whisperApiCredential: string;
  budgetInput: string;
  isBudgetInvalid: boolean;
  monthlySpend: MonthlySpend | null;
  isForgettingCredential: boolean;
  forgetCredentialNotice: CredentialNotice | null;
  forgetCredential: () => void;
  setApiCredential: (credential: string) => void;
  setWhisperApiCredential: (credential: string) => void;
  setBudgetInput: (raw: string) => void;
  setDraft: (patch: Partial<SettingsDraft>) => void;
  save: () => void;
  reset: () => void;
}

export interface UseSettingsOptions {
  open: boolean;
  folder: string | null;
  onSaved?: () => void;
}

export const useSettings = ({ open, folder, onSaved }: UseSettingsOptions): SettingsState => {
  const dictionary = useDictionary();
  const enabled = open && folder !== null;
  const queryClient = useQueryClient();
  const configQuery = useQuery({ ...actions.config(folder === null ? {} : { folder }), enabled });
  const requirementsQuery = useQuery({ ...actions.localAiRequirements, enabled });
  const indexStatusQuery = useQuery({ ...actions.indexStatus, enabled });
  const setConfig = useMutation(actions.setConfig);
  const unsetConfig = useMutation(actions.unsetConfig);
  const setCredential = useMutation(actions.setCredential);
  const deleteCredential = useMutation(actions.deleteCredential);

  const [draft, setDraftState] = useState<SettingsDraft | null>(null);
  const [original, setOriginal] = useState<SettingsDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaveSlow, setIsSaveSlow] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiCredential, setApiCredential] = useState('');
  const [whisperApiCredential, setWhisperApiCredential] = useState('');
  const [budgetInput, setBudgetInputState] = useState('');
  const [forgetCredentialNotice, setForgetCredentialNotice] = useState<CredentialNotice | null>(null);

  const data = configQuery.data;
  useEffect(() => {
    if (!open) {
      setDraftState(null);
      setOriginal(null);
      setSaveError(null);
      setApiCredential('');
      setWhisperApiCredential('');
      setBudgetInputState('');
      setForgetCredentialNotice(null);
      return;
    }
    if (draft !== null || data === undefined || !('config' in data)) return;
    const seeded = draftFromEffective(data.effective);
    setDraftState(seeded);
    setOriginal(seeded);
    setBudgetInputState(formatBudgetInput(seeded.gemini_monthly_budget_usd));
  }, [open, data, draft]);

  const setDraft = useCallback((patch: Partial<SettingsDraft>) => {
    setDraftState((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  const setBudgetInput = useCallback((raw: string) => {
    setBudgetInputState(raw);
    const parsed = parseBudgetInput(raw);
    if (parsed.kind === 'invalid') return;
    setDraft({ gemini_monthly_budget_usd: parsed.kind === 'empty' ? null : parsed.amountUsd });
  }, [setDraft]);

  const reset = useCallback(() => {
    setDraftState(original);
    setBudgetInputState(original === null ? '' : formatBudgetInput(original.gemini_monthly_budget_usd));
    setSaveError(null);
  }, [original]);

  const credentialRef = draft === null ? null : analyzerCredentialRef(draft);
  const forgetCredential = useCallback(() => {
    if (credentialRef === null) return;
    void (async () => {
      setForgetCredentialNotice(null);
      try {
        const deletion = await deleteCredential.mutateAsync({ providerId: credentialRef });
        setForgetCredentialNotice(credentialDeletionNotice(dictionary, deletion));
        await queryClient.invalidateQueries();
      } catch (error) {
        setForgetCredentialNotice({ message: apiErrorMessage(error, dictionary), severity: 'error' });
      }
    })();
  }, [credentialRef, deleteCredential, dictionary, queryClient]);

  const save = useCallback(() => {
    if (draft === null || original === null || folder === null) return;
    const keys = changedKeys(draft, original);
    if (keys.length === 0 && apiCredential.length === 0 && whisperApiCredential.length === 0) return;
    void (async () => {
      setIsSaving(true);
      setIsSaveSlow(false);
      // A locked keychain answers only when `security` is killed, twice over, so the button
      // alone would look frozen for ~20s.
      const slowHint = setTimeout(() => setIsSaveSlow(true), SLOW_SAVE_HINT_MS);
      setSaveError(null);
      let allOk = true;
      let savedCredentialBackend: CredentialsBackendStatus | null = null;
      const folderOverrides = data !== undefined && 'config' in data ? data.config : null;
      for (const key of keys) {
        try {
          await setConfig.mutateAsync({ key, value: serializeValue(draft, key) });
          if (folderOverrides !== null && folderOverrides[key] !== null) {
            await unsetConfig.mutateAsync({ folder, key });
          }
        } catch (error) {
          allOk = false;
          setSaveError(apiErrorMessage(error, dictionary));
        }
      }
      if (
        apiCredential.length > 0
        && (draft.analyzer_provider.family === 'api' || draft.analyzer_provider.family === 'gemini-native')
      ) {
        try {
          const stored = await setCredential.mutateAsync({
            providerId: draft.analyzer_provider.apiKeyRef,
            credential: apiCredential,
          });
          savedCredentialBackend = stored.backend;
          setApiCredential('');
        } catch (error) {
          allOk = false;
          setSaveError(apiErrorMessage(error, dictionary));
        }
      }
      if (whisperApiCredential.length > 0 && draft.whisper_mode === 'api') {
        try {
          const stored = await setCredential.mutateAsync({ providerId: 'openai', credential: whisperApiCredential });
          savedCredentialBackend = stored.backend;
          setWhisperApiCredential('');
        } catch (error) {
          allOk = false;
          setSaveError(apiErrorMessage(error, dictionary));
        }
      }
      clearTimeout(slowHint);
      setIsSaving(false);
      setIsSaveSlow(false);
      if (!allOk) return;
      setOriginal(draft);
      await configQuery.refetch();
      await queryClient.invalidateQueries();
      savedToastStore.show(savedCredentialBackend === null
        ? dictionary.settings.savedToast
        : credentialSavedMessage(dictionary, savedCredentialBackend));
      onSaved?.();
    })();
  }, [
    apiCredential,
    configQuery,
    data,
    dictionary,
    draft,
    folder,
    onSaved,
    original,
    queryClient,
    setConfig,
    setCredential,
    unsetConfig,
    whisperApiCredential,
  ]);

  const hasChanges =
    draft !== null && original !== null && (
      changedKeys(draft, original).length > 0
      || apiCredential.length > 0
      || whisperApiCredential.length > 0
    );
  const isBudgetInvalid =
    draft?.analyzer_provider.family === 'gemini-native' && parseBudgetInput(budgetInput).kind === 'invalid';

  return {
    isLoading: enabled && draft === null && configQuery.error === null,
    error: saveError ?? (configQuery.error === null ? null : apiErrorMessage(configQuery.error, dictionary)),
    draft,
    hasChanges,
    canSave: hasChanges && !isBudgetInvalid,
    isSaving,
    isSaveSlow,
    tiers: requirementsQuery.data?.tiers ?? null,
    apiCredential,
    whisperApiCredential,
    budgetInput,
    isBudgetInvalid,
    monthlySpend: indexStatusQuery.data?.currentMonthSpend ?? null,
    isForgettingCredential: deleteCredential.isPending,
    forgetCredentialNotice,
    forgetCredential,
    setApiCredential,
    setWhisperApiCredential,
    setBudgetInput,
    setDraft,
    save,
    reset,
  };
};
