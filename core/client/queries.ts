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
export type CatalogLockOutput = z.output<typeof API_ROUTES.catalogLockStatus.output>;
export type CatalogTreeInput = z.input<typeof API_ROUTES.catalogTree.input>;
export type CatalogTreeFolderInput = z.input<typeof API_ROUTES.catalogTreeFolder.input>;
export type CatalogFolderInput = z.input<typeof API_ROUTES.catalogFolder.input>;
export type StatusInput = z.input<typeof API_ROUTES.status.input>;
export type ConfigInput = z.input<typeof API_ROUTES.configGet.input>;
export type CheckInput = z.input<typeof API_ROUTES.check.input>;
export type JobInput = z.input<typeof API_ROUTES.jobStatus.input>;
export type ProcessVideoInput = z.input<typeof API_ROUTES.process.input>;
export type ProcessDriveInput = z.input<typeof API_ROUTES.processDrive.input>;
export type GenerateThumbnailInput = z.input<typeof API_ROUTES.thumbnail.input>;
export type ResetAllInput = z.input<typeof API_ROUTES.resetAll.input>;
export type ResetSingleInput = z.input<typeof API_ROUTES.resetSingle.input>;
export type SetConfigInput = z.input<typeof API_ROUTES.configSet.input>;
export type SetCredentialInput = z.input<typeof API_ROUTES.credentialSet.input>;
export type DeleteCredentialInput = z.input<typeof API_ROUTES.credentialDelete.input>;
export type DownloadWhisperModelInput = z.input<typeof API_ROUTES.whisperModelDownload.input>;
export type DeleteWhisperModelInput = z.input<typeof API_ROUTES.whisperModelDelete.input>;
export type UseWhisperModelInput = z.input<typeof API_ROUTES.whisperModelUse.input>;
export type PullLocalAiModelInput = z.input<typeof API_ROUTES.localAiPull.input>;
export type RemoveLocalAiModelInput = z.input<typeof API_ROUTES.localAiRm.input>;
export type CancelJobInput = z.input<typeof API_ROUTES.jobCancel.input>;
export type TestProviderInput = z.input<typeof API_ROUTES.providerTest.input>;
export type ReadinessInput = z.input<typeof API_ROUTES.readiness.input>;
export type SearchInput = z.input<typeof API_ROUTES.searchQuery.input>;
export type InstallFaceArtifactsInput = z.input<typeof API_ROUTES.faceArtifactsInstall.input>;
export type FacesIndexInput = z.input<typeof API_ROUTES.facesIndex.input>;
export type FacesNameInput = z.input<typeof API_ROUTES.facesName.input>;
export type FacesMergeInput = z.input<typeof API_ROUTES.facesMerge.input>;
export type FacesForgetInput = z.input<typeof API_ROUTES.facesForget.input>;
export type FacesPurgeInput = z.input<typeof API_ROUTES.facesPurge.input>;
export type IndexForgetInput = z.input<typeof API_ROUTES.indexForget.input>;
export type JobOutput = z.output<typeof API_ROUTES.jobStatus.output>;
export type SearchOutput = z.output<typeof API_ROUTES.searchQuery.output>;
export type TagsListOutput = z.output<typeof API_ROUTES.tagsList.output>;

export const healthScopes = {
  all: () => ['health'] as const,
};

export const catalogLockScopes = {
  all: () => ['catalog-lock'] as const,
};

export const scanScopes = {
  all: () => ['scan'] as const,
  folder: (input: z.output<typeof API_ROUTES.scan.input>) => ['scan', 'folder', input.folder] as const,
};

export const catalogTreeScopes = {
  all: () => ['catalog-tree'] as const,
  folder: (input: z.output<typeof API_ROUTES.catalogTree.input>) =>
    ['catalog-tree', 'folder', input.folder] as const,
};

export const catalogTreeFolderScopes = {
  all: () => ['catalog-tree-folder'] as const,
  folder: (input: z.output<typeof API_ROUTES.catalogTreeFolder.input>) =>
    ['catalog-tree-folder', 'folder', input.folder] as const,
};

export type CatalogTreeAbsentInput = z.input<typeof API_ROUTES.catalogTreeAbsent.input>;

export const catalogFolderScopes = {
  all: () => ['catalog-folder'] as const,
  folder: (input: z.output<typeof API_ROUTES.catalogFolder.input>) =>
    ['catalog-folder', 'folder', input.folder] as const,
};

export const catalogTreeAbsentScopes = {
  all: () => ['catalog-tree-absent'] as const,
  folder: (input: z.output<typeof API_ROUTES.catalogTreeAbsent.input>) =>
    ['catalog-tree-absent', 'folder', input.folder] as const,
};

export const statusScopes = {
  all: () => ['status'] as const,
  folder: (input: z.output<typeof API_ROUTES.status.input>) => ['status', 'folder', input.folder ?? null] as const,
};

export const configScopes = {
  all: () => ['config'] as const,
  entry: (input: z.output<typeof API_ROUTES.configGet.input>) =>
    ['config', 'folder', input.folder ?? null, input.key === null ? 'all' : 'key', input.key] as const,
};

export const providerScopes = {
  all: () => ['providers'] as const,
};

export const modelsWhisperScopes = {
  all: () => ['models', 'whisper'] as const,
};

export const whisperRuntimeScopes = {
  all: () => ['models', 'whisper-runtime'] as const,
};

export const localAiRequirementsScopes = {
  all: () => ['models', 'local-ai', 'requirements'] as const,
};

export const doctorScopes = {
  all: () => ['doctor'] as const,
};

export const readinessScopes = {
  all: () => ['readiness'] as const,
  target: (input: z.output<typeof API_ROUTES.readiness.input>) =>
    ['readiness', input.scope === 'home' ? 'home' : 'folder', input.folder ?? null] as const,
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

export const searchScopes = {
  all: () => ['search'] as const,
  query: (input: z.output<typeof API_ROUTES.searchQuery.input>) =>
    ['search', input.query, input.limit, input.offset] as const,
};

export const tagsScopes = {
  all: () => ['tags'] as const,
};

export const faceArtifactsScopes = {
  all: () => ['models', 'faces'] as const,
};

export const facesScopes = {
  all: () => ['faces'] as const,
  status: () => ['faces', 'status'] as const,
  people: () => ['faces', 'people'] as const,
};

export const mutationScopes = {
  processVideo: () => ['processVideo'] as const,
  processDrive: () => ['processDrive'] as const,
  generateThumbnail: () => ['generateThumbnail'] as const,
  resetAll: () => ['resetAll'] as const,
  resetSingle: () => ['resetSingle'] as const,
  setConfig: () => ['setConfig'] as const,
  setCredential: () => ['setCredential'] as const,
  deleteCredential: () => ['deleteCredential'] as const,
  downloadWhisperModel: () => ['downloadWhisperModel'] as const,
  deleteWhisperModel: () => ['deleteWhisperModel'] as const,
  useWhisperModel: () => ['useWhisperModel'] as const,
  installWhisperRuntime: () => ['installWhisperRuntime'] as const,
  pullLocalAiModel: () => ['pullLocalAiModel'] as const,
  removeLocalAiModel: () => ['removeLocalAiModel'] as const,
  stopLocalAiDaemon: () => ['stopLocalAiDaemon'] as const,
  cancelJob: () => ['cancelJob'] as const,
  testProvider: () => ['testProvider'] as const,
  catalogLockRetry: () => ['catalogLockRetry'] as const,
  installFaceArtifacts: () => ['installFaceArtifacts'] as const,
  facesIndex: () => ['facesIndex'] as const,
  facesName: () => ['facesName'] as const,
  facesMerge: () => ['facesMerge'] as const,
  facesForget: () => ['facesForget'] as const,
  facesPurge: () => ['facesPurge'] as const,
  indexForget: () => ['indexForget'] as const,
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

export const catalogLockRefetchInterval =
  (intervalMs = 5_000) =>
  (query: RefetchQuery<CatalogLockOutput>): number | false =>
    query.state.data?.blockedBy != null ? intervalMs : false;

export const catalogLockQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: catalogLockScopes.all(),
    staleTime: 0,
    refetchInterval: catalogLockRefetchInterval(),
    call: ({ signal }) => api.catalogLockStatus(signal),
  });

export const catalogLockRetryMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.catalogLockRetry(),
    call: () => api.catalogLockRetry(),
  });

export const scanQuery = (api: ApiClient, input: ScanInput) => {
  const parsed = API_ROUTES.scan.input.parse(input);
  return defineQuery({
    queryKey: scanScopes.folder(parsed),
    call: ({ signal }) => api.scan(parsed, signal),
  });
};

export const catalogTreeQuery = (api: ApiClient, input: CatalogTreeInput) => {
  const parsed = API_ROUTES.catalogTree.input.parse(input);
  return defineQuery({
    queryKey: catalogTreeScopes.folder(parsed),
    call: ({ signal }) => api.catalogTree(parsed, signal),
  });
};

export const catalogTreeFolderQuery = (api: ApiClient, input: CatalogTreeFolderInput) => {
  const parsed = API_ROUTES.catalogTreeFolder.input.parse(input);
  return defineQuery({
    queryKey: catalogTreeFolderScopes.folder(parsed),
    call: ({ signal }) => api.catalogTreeFolder(parsed, signal),
  });
};

export const catalogFolderQuery = (api: ApiClient, input: CatalogFolderInput) => {
  const parsed = API_ROUTES.catalogFolder.input.parse(input);
  return defineQuery({
    queryKey: catalogFolderScopes.folder(parsed),
    call: ({ signal }) => api.catalogFolder(parsed, signal),
  });
};

export const catalogTreeAbsentQuery = (api: ApiClient, input: CatalogTreeAbsentInput) => {
  const parsed = API_ROUTES.catalogTreeAbsent.input.parse(input);
  return defineQuery({
    queryKey: catalogTreeAbsentScopes.folder(parsed),
    call: ({ signal }) => api.catalogTreeAbsent(parsed, signal),
  });
};

export const statusQuery = (api: ApiClient, input: StatusInput = {}) => {
  const parsed = API_ROUTES.status.input.parse(input);
  return defineQuery({
    queryKey: statusScopes.folder(parsed),
    call: ({ signal }) => api.status(parsed, signal),
  });
};

export const configQuery = (api: ApiClient, input: ConfigInput = {}) => {
  const parsed = API_ROUTES.configGet.input.parse(input);
  return defineQuery({
    queryKey: configScopes.entry(parsed),
    call: ({ signal }) => api.config(parsed, signal),
  });
};

export const providersQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: providerScopes.all(),
    call: ({ signal }) => api.providers(signal),
  });

export const modelsWhisperQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: modelsWhisperScopes.all(),
    call: ({ signal }) => api.modelsWhisper(signal),
  });

export const whisperRuntimeQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: whisperRuntimeScopes.all(),
    call: ({ signal }) => api.whisperRuntimeStatus(signal),
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

export const readinessQuery = (api: ApiClient, input: ReadinessInput = {}) => {
  const parsed = API_ROUTES.readiness.input.parse(input);
  const requestInput: ReadinessInput = {
    ...(parsed.folder === undefined ? {} : { folder: parsed.folder }),
    ...(parsed.scope === undefined ? {} : { scope: parsed.scope }),
    refresh: parsed.refresh ? 'true' : 'false',
  };
  return defineQuery({
    queryKey: readinessScopes.target(parsed),
    staleTime: 0,
    call: ({ signal }) => api.readiness(requestInput, signal),
  });
};

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
    staleTime: 0,
    refetchInterval: jobProgressRefetchInterval(),
    call: ({ signal }) => api.job(parsed, signal),
  });
};

export const jobsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: jobScopes.list(),
    call: ({ signal }) => api.jobs(signal),
  });

export const searchQuery = (api: ApiClient, input: SearchInput) => {
  const parsed = API_ROUTES.searchQuery.input.parse(input);
  return defineQuery({
    queryKey: searchScopes.query(parsed),
    staleTime: 0,
    call: ({ signal }) => api.search(parsed, signal),
  });
};

export const tagsListQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tagsScopes.all(),
    call: ({ signal }) => api.listTags(signal),
  });

export const faceArtifactsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: faceArtifactsScopes.all(),
    call: ({ signal }) => api.faceArtifactsStatus(signal),
  });

export const facesStatusQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: facesScopes.status(),
    staleTime: 0,
    call: ({ signal }) => api.facesStatus(signal),
  });

export const facesPeopleQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: facesScopes.people(),
    staleTime: 0,
    call: ({ signal }) => api.facesPeople(signal),
  });

export const processVideoMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.processVideo(),
    call: (variables: ProcessVideoInput) => api.processVideo(variables),
  });

export const processDriveMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.processDrive(),
    call: (variables: ProcessDriveInput) => api.processDrive(variables),
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

export const setCredentialMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.setCredential(),
    call: (variables: SetCredentialInput) => api.setCredential(variables),
  });

export const deleteCredentialMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.deleteCredential(),
    call: (variables: DeleteCredentialInput) => api.deleteCredential(variables),
  });

export const testProviderMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.testProvider(),
    call: (variables: TestProviderInput) => api.testProvider(variables),
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

export const installWhisperRuntimeMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.installWhisperRuntime(),
    call: () => api.installWhisperRuntime(),
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

export const installFaceArtifactsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.installFaceArtifacts(),
    call: (variables: InstallFaceArtifactsInput) => api.installFaceArtifacts(variables),
  });

export const facesIndexMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.facesIndex(),
    call: (variables: FacesIndexInput) => api.facesIndex(variables),
  });

export const facesNameMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.facesName(),
    call: (variables: FacesNameInput) => api.facesName(variables),
  });

export const facesMergeMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.facesMerge(),
    call: (variables: FacesMergeInput) => api.facesMerge(variables),
  });

export const facesForgetMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.facesForget(),
    call: (variables: FacesForgetInput) => api.facesForget(variables),
  });

export const facesPurgeMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.facesPurge(),
    call: (variables: FacesPurgeInput) => api.facesPurge(variables),
  });

export const indexForgetMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: mutationScopes.indexForget(),
    call: (variables: IndexForgetInput) => api.indexForget(variables),
  });
