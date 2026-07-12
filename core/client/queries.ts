import type {
  DefaultError,
  MutationFunction,
  MutationKey,
  MutationOptions,
  QueryObserverOptions,
  QueryFunction,
  QueryFunctionContext,
  QueryKey,
} from '@tanstack/query-core';
import { type z } from 'zod';

import { API_ROUTES } from '@core/contract/index.js';

import { unwrap, type ApiClient, type ReadResult, type WriteResult } from './http.js';

export type QueryDescriptor<TQueryFnData, TQueryKey extends QueryKey> = QueryObserverOptions<
  TQueryFnData,
  DefaultError,
  TQueryFnData,
  TQueryFnData,
  TQueryKey
> & { queryFn: QueryFunction<TQueryFnData, TQueryKey> };

type ReadCall<TQueryFnData, TQueryKey extends QueryKey> = (
  context: QueryFunctionContext<TQueryKey>,
) => Promise<ReadResult<TQueryFnData>>;

type DefineQueryInput<TQueryFnData, TQueryKey extends QueryKey> = Omit<
  QueryDescriptor<TQueryFnData, TQueryKey>,
  'queryFn'
> & { call: ReadCall<TQueryFnData, TQueryKey> };

export const defineQuery = <TQueryFnData, TQueryKey extends QueryKey>(
  input: DefineQueryInput<TQueryFnData, TQueryKey>,
): QueryDescriptor<TQueryFnData, TQueryKey> => {
  const { call, ...rest } = input;
  return { ...rest, queryFn: async (context) => unwrap(await call(context)) };
};

export type MutationDescriptor<TData, TVariables> = MutationOptions<
  TData,
  DefaultError,
  TVariables
> & { mutationKey: MutationKey; mutationFn: MutationFunction<TData, TVariables> };

type WriteCall<TData, TVariables> = (variables: TVariables) => Promise<WriteResult<TData>>;

type DefineMutationInput<TData, TVariables> = Omit<
  MutationDescriptor<TData, TVariables>,
  'mutationFn'
> & { call: WriteCall<TData, TVariables> };

export const defineMutation = <TData, TVariables>(
  input: DefineMutationInput<TData, TVariables>,
): MutationDescriptor<TData, TVariables> => {
  const { call, ...rest } = input;
  return { ...rest, mutationFn: async (variables) => unwrap(await call(variables)) };
};

export type ScanInput = z.input<typeof API_ROUTES.scan.input>;
export type ConfigInput = z.input<typeof API_ROUTES.configGet.input>;
export type CheckInput = z.input<typeof API_ROUTES.check.input>;
export type JobInput = z.input<typeof API_ROUTES.jobStatus.input>;
export type ProcessVideoInput = z.input<typeof API_ROUTES.process.input>;
export type GenerateThumbnailInput = z.input<typeof API_ROUTES.thumbnail.input>;
export type ResetAllInput = z.input<typeof API_ROUTES.resetAll.input>;
export type ResetSingleInput = z.input<typeof API_ROUTES.resetSingle.input>;
export type SetConfigInput = z.input<typeof API_ROUTES.configSet.input>;
export type DownloadWhisperModelInput = z.input<typeof API_ROUTES.whisperModelDownload.input>;
export type DeleteWhisperModelInput = z.input<typeof API_ROUTES.whisperModelDelete.input>;
export type UseWhisperModelInput = z.input<typeof API_ROUTES.whisperModelUse.input>;
export type PullLocalAiModelInput = z.input<typeof API_ROUTES.localAiPull.input>;
export type RemoveLocalAiModelInput = z.input<typeof API_ROUTES.localAiRm.input>;
export type CancelJobInput = z.input<typeof API_ROUTES.jobCancel.input>;
export type JobOutput = z.output<typeof API_ROUTES.jobStatus.output>;

export const healthScopes = {
  all: () => ['health'] as const,
};

export const scanScopes = {
  all: () => ['scan'] as const,
  folder: (input: z.output<typeof API_ROUTES.scan.input>) => ['scan', 'folder', input.folder] as const,
};

export const statusScopes = {
  all: () => ['status'] as const,
};

export const configScopes = {
  all: () => ['config'] as const,
  entry: (input: z.output<typeof API_ROUTES.configGet.input>) =>
    ['config', input.key === null ? 'all' : 'key', input.key] as const,
};

export const modelsWhisperScopes = {
  all: () => ['models', 'whisper'] as const,
};

export const localAiRequirementsScopes = {
  all: () => ['models', 'local-ai', 'requirements'] as const,
};

export const doctorScopes = {
  all: () => ['doctor'] as const,
};

export const checkScopes = {
  all: () => ['check'] as const,
  folder: (input: z.output<typeof API_ROUTES.check.input>) => ['check', 'folder', input.folder] as const,
};

export const jobScopes = {
  all: () => ['jobs'] as const,
  list: () => ['jobs', 'list'] as const,
  detail: (input: z.output<typeof API_ROUTES.jobStatus.input>) => ['jobs', 'detail', input.jobId] as const,
};

export const mutationScopes = {
  processVideo: () => ['processVideo'] as const,
  generateThumbnail: () => ['generateThumbnail'] as const,
  resetAll: () => ['resetAll'] as const,
  resetSingle: () => ['resetSingle'] as const,
  setConfig: () => ['setConfig'] as const,
  downloadWhisperModel: () => ['downloadWhisperModel'] as const,
  deleteWhisperModel: () => ['deleteWhisperModel'] as const,
  useWhisperModel: () => ['useWhisperModel'] as const,
  pullLocalAiModel: () => ['pullLocalAiModel'] as const,
  removeLocalAiModel: () => ['removeLocalAiModel'] as const,
  stopLocalAiDaemon: () => ['stopLocalAiDaemon'] as const,
  cancelJob: () => ['cancelJob'] as const,
};

interface RefetchQuery<TData> {
  state: {
    data: TData | undefined;
  };
}

export const isTerminalJobStatus = (status: JobOutput['status'] | undefined): boolean => {
  switch (status) {
    case 'completed':
    case 'failed':
    case 'cancelled':
      return true;
    case 'queued':
    case 'running':
    case undefined:
      return false;
  }
};

export const jobProgressRefetchInterval =
  (intervalMs = 1_000) =>
  (query: RefetchQuery<JobOutput>): number | false =>
    isTerminalJobStatus(query.state.data?.status) ? false : intervalMs;

export const healthQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: healthScopes.all(),
    call: ({ signal }) => api.health(signal),
  });

export const scanQuery = (api: ApiClient, input: ScanInput) => {
  const parsed = API_ROUTES.scan.input.parse(input);
  return defineQuery({
    queryKey: scanScopes.folder(parsed),
    call: ({ signal }) => api.scan(parsed, signal),
  });
};

export const statusQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: statusScopes.all(),
    call: ({ signal }) => api.status(signal),
  });

export const configQuery = (api: ApiClient, input: ConfigInput = {}) => {
  const parsed = API_ROUTES.configGet.input.parse(input);
  return defineQuery({
    queryKey: configScopes.entry(parsed),
    call: ({ signal }) => api.config(parsed, signal),
  });
};

export const modelsWhisperQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: modelsWhisperScopes.all(),
    call: ({ signal }) => api.modelsWhisper(signal),
  });

export const localAiRequirementsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: localAiRequirementsScopes.all(),
    call: ({ signal }) => api.localAiRequirements(signal),
  });

export const doctorQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: doctorScopes.all(),
    call: ({ signal }) => api.doctor(signal),
  });

export const checkQuery = (api: ApiClient, input: CheckInput) => {
  const parsed = API_ROUTES.check.input.parse(input);
  return defineQuery({
    queryKey: checkScopes.folder(parsed),
    call: ({ signal }) => api.check(parsed, signal),
  });
};

export const jobQuery = (api: ApiClient, input: JobInput) => {
  const parsed = API_ROUTES.jobStatus.input.parse(input);
  return defineQuery({
    queryKey: jobScopes.detail(parsed),
    refetchInterval: jobProgressRefetchInterval(),
    call: ({ signal }) => api.job(parsed, signal),
  });
};

export const jobsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: jobScopes.list(),
    call: ({ signal }) => api.jobs(signal),
  });

export const processVideoMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.processVideo(),
    call: (variables: ProcessVideoInput) => api.processVideo(variables),
  });

export const generateThumbnailMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.generateThumbnail(),
    call: (variables: GenerateThumbnailInput) => api.generateThumbnail(variables),
  });

export const resetAllMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.resetAll(),
    call: (variables: ResetAllInput) => api.resetAll(variables),
  });

export const resetSingleMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.resetSingle(),
    call: (variables: ResetSingleInput) => api.resetSingle(variables),
  });

export const setConfigMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.setConfig(),
    call: (variables: SetConfigInput) => api.setConfig(variables),
  });

export const downloadWhisperModelMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.downloadWhisperModel(),
    call: (variables: DownloadWhisperModelInput) => api.downloadWhisperModel(variables),
  });

export const deleteWhisperModelMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.deleteWhisperModel(),
    call: (variables: DeleteWhisperModelInput) => api.deleteWhisperModel(variables),
  });

export const useWhisperModelMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.useWhisperModel(),
    call: (variables: UseWhisperModelInput) => api.useWhisperModel(variables),
  });

export const pullLocalAiModelMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.pullLocalAiModel(),
    call: (variables: PullLocalAiModelInput) => api.pullLocalAiModel(variables),
  });

export const removeLocalAiModelMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.removeLocalAiModel(),
    call: (variables: RemoveLocalAiModelInput) => api.removeLocalAiModel(variables),
  });

export const stopLocalAiDaemonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.stopLocalAiDaemon(),
    call: () => api.stopLocalAiDaemon(),
  });

export const cancelJobMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.cancelJob(),
    call: (variables: CancelJobInput) => api.cancelJob(variables),
  });
