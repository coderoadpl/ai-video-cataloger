import {
  cancelJobMutation,
  checkQuery,
  configQuery,
  createApiClient,
  deleteWhisperModelMutation,
  doctorQuery,
  downloadWhisperModelMutation,
  generateThumbnailMutation,
  healthQuery,
  jobQuery,
  jobsQuery,
  localAiRequirementsQuery,
  modelsWhisperQuery,
  processVideoMutation,
  pullLocalAiModelMutation,
  removeLocalAiModelMutation,
  resetAllMutation,
  resetSingleMutation,
  scanQuery,
  setConfigMutation,
  statusQuery,
  stopLocalAiDaemonMutation,
  useWhisperModelMutation as bindActivateWhisperModel,
  type CheckInput,
  type ConfigInput,
  type JobInput,
  type ScanInput,
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

/**
 * Adapts the preload bridge's typed `request` into a `fetch`-shaped function so
 * the same `core/client` ApiClient runs unchanged over Electron IPC. This is
 * the only transport seam: the renderer never touches `fetch` or `electron`.
 */
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

/**
 * Stand-in bridge for running the renderer under a bare Vite dev server (no
 * Electron shell). Platform capabilities degrade to inert defaults; the
 * ApiClient falls back to same-origin HTTP through the Vite `/api` proxy.
 */
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
};

const realBridge: DesktopBridge | undefined =
  typeof window === 'undefined' || typeof window.desktopBridge === 'undefined'
    ? undefined
    : window.desktopBridge;

/** The desktop bridge (real preload adapter, or the dev fallback), wired once here. */
export const bridge: DesktopBridge = realBridge ?? devBridge;

const apiClient =
  realBridge === undefined
    ? createApiClient({ baseUrl: '' })
    : createApiClient({ baseUrl: '', fetchImpl: bridgeFetch(realBridge.api) });

/**
 * The one binding site. `core/client` action factories are bound to their
 * transport exactly once here; features import these ready actions and never
 * see a client, a port, or an adapter. Parametric queries stay factories so a
 * feature supplies the folder/key/job it needs.
 */
export const actions = {
  health: healthQuery(apiClient),
  status: statusQuery(apiClient),
  modelsWhisper: modelsWhisperQuery(apiClient),
  localAiRequirements: localAiRequirementsQuery(apiClient),
  doctor: doctorQuery(apiClient),
  jobs: jobsQuery(apiClient),
  scan: (input: ScanInput) => scanQuery(apiClient, input),
  config: (input?: ConfigInput) => configQuery(apiClient, input),
  check: (input: CheckInput) => checkQuery(apiClient, input),
  job: (input: JobInput) => jobQuery(apiClient, input),
  processVideo: processVideoMutation(apiClient),
  generateThumbnail: generateThumbnailMutation(apiClient),
  resetAll: resetAllMutation(apiClient),
  resetSingle: resetSingleMutation(apiClient),
  setConfig: setConfigMutation(apiClient),
  downloadWhisperModel: downloadWhisperModelMutation(apiClient),
  deleteWhisperModel: deleteWhisperModelMutation(apiClient),
  useWhisperModel: bindActivateWhisperModel(apiClient),
  pullLocalAiModel: pullLocalAiModelMutation(apiClient),
  removeLocalAiModel: removeLocalAiModelMutation(apiClient),
  stopLocalAiDaemon: stopLocalAiDaemonMutation(apiClient),
  cancelJob: cancelJobMutation(apiClient),
};

declare global {
  interface Window {
    desktopBridge: DesktopBridge;
  }
}
