import {
  cancelJobMutation,
  catalogFolderQuery,
  catalogLockQuery,
  catalogLockRetryMutation,
  catalogTreeQuery,
  checkQuery,
  configQuery,
  createApiClient,
  deleteWhisperModelMutation,
  doctorQuery,
  downloadWhisperModelMutation,
  faceArtifactsQuery,
  facesForgetMutation,
  facesIndexMutation,
  facesMergeMutation,
  facesNameMutation,
  facesPeopleQuery,
  facesPurgeMutation,
  facesStatusQuery,
  generateThumbnailMutation,
  healthQuery,
  indexForgetMutation,
  installFaceArtifactsMutation,
  installWhisperRuntimeMutation,
  jobQuery,
  jobsQuery,
  localAiRequirementsQuery,
  modelsWhisperQuery,
  processDriveMutation,
  processVideoMutation,
  providersQuery,
  readinessQuery,
  testProviderMutation,
  pullLocalAiModelMutation,
  removeLocalAiModelMutation,
  resetAllMutation,
  resetSingleMutation,
  scanQuery,
  searchQuery,
  setConfigMutation,
  setCredentialMutation,
  statusQuery,
  stopLocalAiDaemonMutation,
  tagsListQuery,
  useWhisperModelMutation as bindActivateWhisperModel,
  whisperRuntimeQuery,
  type CatalogFolderInput,
  type CatalogTreeInput,
  type CheckInput,
  type ConfigInput,
  type JobInput,
  type ScanInput,
  type SearchInput,
  type ReadinessInput,
  type StatusInput,
} from '@core/client/index.js';
import type { DesktopApiBridge, DesktopBridge } from '@core/contract/index.js';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const headerRecord = (headers: HeadersInit | undefined): Record<string, string> | undefined => {
  if (headers === undefined) return undefined;
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
};

const bridgeFetch =
  (api: DesktopApiBridge): FetchLike =>
  async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = headerRecord(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : null;
    const response = await api.request({
      url,
      ...(init?.method === undefined ? {} : { method: init.method }),
      ...(headers === undefined ? {} : { headers }),
      body,
    });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

const noopUnsubscribe = () => undefined;

const devBridge: DesktopBridge = {
  platform: 'web',
  getAppVersion: () => Promise.resolve('dev'),
  api: { request: () => Promise.reject(new Error('desktop bridge unavailable in the browser')) },
  folder: {
    showPicker: () => Promise.resolve(null),
    getCurrent: () => Promise.resolve(null),
    setCurrent: () => Promise.resolve(),
    getRecent: () => Promise.resolve([]),
    removeRecent: () => Promise.resolve(),
    clearRecent: () => Promise.resolve(),
  },
  revealInFinder: () => Promise.resolve(),
  window: { close: () => undefined, minimize: () => undefined, maximize: () => undefined },
  menu: { on: () => noopUnsubscribe },
  onboarding: { getCompleted: () => Promise.resolve(true), setCompleted: () => Promise.resolve() },
};

const realBridge: DesktopBridge | undefined =
  typeof window === 'undefined' || typeof window.desktopBridge === 'undefined'
    ? undefined
    : window.desktopBridge;

export const bridge: DesktopBridge = realBridge ?? devBridge;

const apiClient =
  realBridge === undefined
    ? createApiClient({ baseUrl: '' })
    : createApiClient({ baseUrl: '', fetchImpl: bridgeFetch(realBridge.api) });

export const actions = {
  health: healthQuery(apiClient),
  status: (input?: StatusInput) => statusQuery(apiClient, input),
  catalogLock: catalogLockQuery(apiClient),
  catalogLockRetry: catalogLockRetryMutation(apiClient),
  modelsWhisper: modelsWhisperQuery(apiClient),
  faceArtifacts: faceArtifactsQuery(apiClient),
  whisperRuntime: whisperRuntimeQuery(apiClient),
  localAiRequirements: localAiRequirementsQuery(apiClient),
  doctor: doctorQuery(apiClient),
  providers: providersQuery(apiClient),
  testProvider: testProviderMutation(apiClient),
  readiness: (input?: ReadinessInput) => readinessQuery(apiClient, input),
  jobs: jobsQuery(apiClient),
  scan: (input: ScanInput) => scanQuery(apiClient, input),
  catalogTree: (input: CatalogTreeInput) => catalogTreeQuery(apiClient, input),
  catalogFolder: (input: CatalogFolderInput) => catalogFolderQuery(apiClient, input),
  search: (input: SearchInput) => searchQuery(apiClient, input),
  tagsList: tagsListQuery(apiClient),
  facesStatus: facesStatusQuery(apiClient),
  facesPeople: facesPeopleQuery(apiClient),
  config: (input?: ConfigInput) => configQuery(apiClient, input),
  check: (input: CheckInput) => checkQuery(apiClient, input),
  job: (input: JobInput) => jobQuery(apiClient, input),
  processVideo: processVideoMutation(apiClient),
  processDrive: processDriveMutation(apiClient),
  generateThumbnail: generateThumbnailMutation(apiClient),
  resetAll: resetAllMutation(apiClient),
  resetSingle: resetSingleMutation(apiClient),
  setConfig: setConfigMutation(apiClient),
  setCredential: setCredentialMutation(apiClient),
  downloadWhisperModel: downloadWhisperModelMutation(apiClient),
  deleteWhisperModel: deleteWhisperModelMutation(apiClient),
  useWhisperModel: bindActivateWhisperModel(apiClient),
  installWhisperRuntime: installWhisperRuntimeMutation(apiClient),
  installFaceArtifacts: installFaceArtifactsMutation(apiClient),
  facesIndex: facesIndexMutation(apiClient),
  facesName: facesNameMutation(apiClient),
  facesMerge: facesMergeMutation(apiClient),
  facesForget: facesForgetMutation(apiClient),
  facesPurge: facesPurgeMutation(apiClient),
  pullLocalAiModel: pullLocalAiModelMutation(apiClient),
  removeLocalAiModel: removeLocalAiModelMutation(apiClient),
  stopLocalAiDaemon: stopLocalAiDaemonMutation(apiClient),
  cancelJob: cancelJobMutation(apiClient),
  indexForget: indexForgetMutation(apiClient),
};

declare global {
  interface Window {
    desktopBridge: DesktopBridge;
  }
}
