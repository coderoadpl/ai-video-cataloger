import {
  cancelJobMutation,
  catalogFolderQuery,
  catalogLocationsQuery,
  catalogLockQuery,
  catalogLockRetryMutation,
  catalogTreeAbsentQuery,
  catalogTreeFolderQuery,
  catalogTreeQuery,
  checkQuery,
  configQuery,
  createApiClient,
  deleteCredentialMutation,
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
  indexStatusQuery,
  installFaceArtifactsMutation,
  installWhisperRuntimeMutation,
  jobQuery,
  jobsQuery,
  libraryCollectionQuery,
  libraryFacetsQuery,
  libraryPreviewQuery,
  localAiRequirementsQuery,
  modelsWhisperQuery,
  photosDetailQuery,
  photosForgetMutation,
  photosFolderTreeQuery,
  photosGridThumbsMutation,
  photosListQuery,
  photosProcessMutation,
  photosProxiesMutation,
  photosScanMutation,
  photosSearchQuery,
  photosStatusQuery,
  photosTreeFolderQuery,
  photosTreeQuery,
  photosVariantsQuery,
  photosVariantsSelectMutation,
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
  selectVariantMutation,
  setConfigMutation,
  unsetConfigMutation,
  setCredentialMutation,
  setFolderDefaultVariantMutation,
  statusQuery,
  stopLocalAiDaemonMutation,
  tagsListQuery,
  thumbnailsBackfillMutation,
  variantsQuery,
  useWhisperModelMutation as bindActivateWhisperModel,
  whisperRuntimeQuery,
  type CatalogFolderInput,
  type CatalogTreeAbsentInput,
  type CatalogTreeInput,
  type CatalogTreeFolderInput,
  type CheckInput,
  type CollectionInput,
  type ConfigInput,
  type JobInput,
  type LibraryPreviewInput,
  type PhotosDetailInput,
  type PhotosListInput,
  type PhotosSearchInput,
  type PhotosStatusInput,
  type PhotosTreeFolderInput,
  type PhotosVariantsListInput,
  type ScanInput,
  type SearchInput,
  type ReadinessInput,
  type StatusInput,
  type VariantsInput,
} from '@core/client/index.js';
import type { DesktopApiBridge, DesktopBridge } from '@core/contract/index.js';

import { instrumentFetch, type FetchLike } from './api-log.js';

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
    onChanged: () => noopUnsubscribe,
  },
  revealInFinder: () => Promise.resolve(true),
  window: { close: () => undefined, minimize: () => undefined, maximize: () => undefined },
  menu: { on: () => noopUnsubscribe },
  onboarding: { getCompleted: () => Promise.resolve(true), setCompleted: () => Promise.resolve() },
};

const realBridge: DesktopBridge | undefined =
  typeof window === 'undefined' || typeof window.desktopBridge === 'undefined'
    ? undefined
    : window.desktopBridge;

export const bridge: DesktopBridge = realBridge ?? devBridge;

const rawFetch: FetchLike =
  realBridge === undefined ? (input, init) => fetch(input, init) : bridgeFetch(realBridge.api);

const apiClient = createApiClient({ baseUrl: '', fetchImpl: instrumentFetch(rawFetch) });

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
  catalogTreeFolder: (input: CatalogTreeFolderInput) => catalogTreeFolderQuery(apiClient, input),
  catalogFolder: (input: CatalogFolderInput) => catalogFolderQuery(apiClient, input),
  catalogLocations: catalogLocationsQuery(apiClient),
  catalogTreeAbsent: (input: CatalogTreeAbsentInput) => catalogTreeAbsentQuery(apiClient, input),
  search: (input: SearchInput) => searchQuery(apiClient, input),
  libraryCollection: (input: CollectionInput) => libraryCollectionQuery(apiClient, input),
  libraryFacets: libraryFacetsQuery(apiClient),
  libraryPreview: (input: LibraryPreviewInput) => libraryPreviewQuery(apiClient, input),
  variants: (input: VariantsInput) => variantsQuery(apiClient, input),
  selectVariant: selectVariantMutation(apiClient),
  setFolderDefaultVariant: setFolderDefaultVariantMutation(apiClient),
  tagsList: tagsListQuery(apiClient),
  facesStatus: facesStatusQuery(apiClient),
  indexStatus: indexStatusQuery(apiClient),
  facesPeople: facesPeopleQuery(apiClient),
  config: (input?: ConfigInput) => configQuery(apiClient, input),
  check: (input: CheckInput) => checkQuery(apiClient, input),
  job: (input: JobInput) => jobQuery(apiClient, input),
  processVideo: processVideoMutation(apiClient),
  processDrive: processDriveMutation(apiClient),
  generateThumbnail: generateThumbnailMutation(apiClient),
  thumbnailsBackfill: thumbnailsBackfillMutation(apiClient),
  resetAll: resetAllMutation(apiClient),
  resetSingle: resetSingleMutation(apiClient),
  setConfig: setConfigMutation(apiClient),
  unsetConfig: unsetConfigMutation(apiClient),
  setCredential: setCredentialMutation(apiClient),
  deleteCredential: deleteCredentialMutation(apiClient),
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
  photosStatus: (input?: PhotosStatusInput) => photosStatusQuery(apiClient, input),
  photosTree: photosTreeQuery(apiClient),
  photosFolderTree: photosFolderTreeQuery(apiClient),
  photosTreeFolder: (input: PhotosTreeFolderInput) => photosTreeFolderQuery(apiClient, input),
  photosList: (input: PhotosListInput) => photosListQuery(apiClient, input),
  photosDetail: (input: PhotosDetailInput) => photosDetailQuery(apiClient, input),
  photosScan: photosScanMutation(apiClient),
  photosProxies: photosProxiesMutation(apiClient),
  photosGridThumbs: photosGridThumbsMutation(apiClient),
  photosForget: photosForgetMutation(apiClient),
  photosProcess: photosProcessMutation(apiClient),
  photosSearch: (input: PhotosSearchInput) => photosSearchQuery(apiClient, input),
  photosVariants: (input: PhotosVariantsListInput) => photosVariantsQuery(apiClient, input),
  photosVariantsSelect: photosVariantsSelectMutation(apiClient),
};

declare global {
  interface Window {
    desktopBridge: DesktopBridge;
  }
}
