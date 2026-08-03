const CONFIG_KEYS = [
  'whisper_binary_path',
  'whisper_model',
  'whisper_language',
  'whisper_mode',
  'whisper_api_base_url',
  'whisper_api_model',
  'frames',
  'timeout',
  'skip_rename',
  'analyzer_backend',
  'local_model',
  'analyzer_provider',
  'faces_enabled',
  'gemini_batch_mode',
  'gemini_monthly_budget_usd',
  'output_language',
  'tag_language',
  'ui_language',
] as const;

const record = <T,>(build: (key: string) => T): Record<string, T> =>
  Object.fromEntries(CONFIG_KEYS.map((key) => [key, build(key)]));

export const configResponse = (uiLanguage: string) => ({
  ok: true,
  data: {
    config: record(() => null),
    defaults: record((key) => (key === 'ui_language' ? 'en' : 'x')),
    effective: record((key) => (key === 'ui_language' ? uiLanguage : 'x')),
    sources: record(() => 'default'),
  },
});
