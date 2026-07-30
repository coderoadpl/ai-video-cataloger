import { type z } from 'zod';

import {
  API_ROUTES,
  catalogFolderOutputSchema,
  catalogLocationsOutputSchema,
  catalogLockOutputSchema,
  catalogTreeAbsentOutputSchema,
  catalogTreeFolderOutputSchema,
  catalogTreeOutputSchema,
  checkOutputSchema,
  configGetOutputSchema,
  configSetOutputSchema,
  credentialDeleteOutputSchema,
  credentialSetOutputSchema,
  doctorOutputSchema,
  faceArtifactsStatusOutputSchema,
  facesForgetOutputSchema,
  facesMergeOutputSchema,
  facesNameOutputSchema,
  facesPeopleOutputSchema,
  facesPurgeOutputSchema,
  facesStatusOutputSchema,
  healthLiveOutputSchema,
  healthOutputSchema,
  healthReadyOutputSchema,
  indexForgetOutputSchema,
  indexRebuildOutputSchema,
  indexStatusOutputSchema,
  jobAcceptedOutputSchema,
  jobCancelOutputSchema,
  jobOutputSchema,
  jobsListOutputSchema,
  localAiDaemonStopOutputSchema,
  localAiRequirementsOutputSchema,
  providersListOutputSchema,
  readinessOutputSchema,
  providerTestOutputSchema,
  localAiRmOutputSchema,
  looseEnvelopeSchema,
  photosDetailOutputSchema,
  photosForgetOutputSchema,
  photosListOutputSchema,
  photosStatusOutputSchema,
  photosTreeOutputSchema,
  resetAllOutputSchema,
  resetSingleOutputSchema,
  scanOutputSchema,
  searchOutputSchema,
  statusOutputSchema,
  tagsAliasOutputSchema,
  tagsListOutputSchema,
  tagsSuggestAliasesOutputSchema,
  thumbnailOutputSchema,
  variantDeleteOutputSchema,
  variantFolderDefaultOutputSchema,
  variantSelectOutputSchema,
  variantsListOutputSchema,
  type HttpMethod,
  type ReadMethod,
  type WriteMethod,
  whisperModelDeleteOutputSchema,
  whisperModelUseOutputSchema,
  whisperModelsListOutputSchema,
  whisperRuntimeStatusOutputSchema,
} from '@core/contract/index.js';
import { err, internal, ok, validation, type AppError, type Result } from '@core/domain/index.js';

declare const HTTP_METHOD_BRAND: unique symbol;

type Branded<T, M extends HttpMethod> = T & { readonly [HTTP_METHOD_BRAND]?: M };
export type ReadResult<T> = Branded<Result<T, AppError>, ReadMethod>;
export type WriteResult<T> = Branded<Result<T, AppError>, WriteMethod>;

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  headers?: () => Record<string, string>;
}

const request = async <S extends z.ZodTypeAny, M extends HttpMethod>(
  options: ApiClientOptions,
  method: M,
  path: string,
  outputSchema: S,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Branded<Result<z.output<S>, AppError>, M>> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers?.(),
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (cause) {
    return err(internal(`Network error calling ${path}: ${String(cause)}`));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return err(internal(`Non-JSON response from ${path} (HTTP ${response.status})`));
  }

  const envelope = looseEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return err(internal(`Response from ${path} does not match the contract envelope`));
  }
  if (!envelope.data.ok) return err(envelope.data.error);

  const data = outputSchema.safeParse(envelope.data.data);
  if (!data.success) {
    return err(internal(`Response data from ${path} does not match the contract`));
  }
  return ok(data.data);
};

const parseInput = <S extends z.ZodTypeAny>(
  schema: S,
  input: z.input<S>,
): Result<z.output<S>, AppError> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return err(validation('Client input does not match the contract', parsed.error.flatten()));
  return ok(parsed.data);
};

const queryPath = (path: string, entries: ReadonlyArray<readonly [string, string | null | undefined]>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== null && value !== undefined) params.set(key, value);
  }
  const query = params.toString();
  return query.length === 0 ? path : `${path}?${query}`;
};

export const createApiClient = (options: ApiClientOptions) => ({
  health: (signal?: AbortSignal) =>
    request(options, API_ROUTES.health.method, API_ROUTES.health.path, healthOutputSchema, undefined, signal),
  healthLive: (signal?: AbortSignal) =>
    request(options, API_ROUTES.healthLive.method, API_ROUTES.healthLive.path, healthLiveOutputSchema, undefined, signal),
  healthReady: (signal?: AbortSignal) =>
    request(options, API_ROUTES.healthReady.method, API_ROUTES.healthReady.path, healthReadyOutputSchema, undefined, signal),
  catalogLockStatus: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.catalogLockStatus.method,
      API_ROUTES.catalogLockStatus.path,
      catalogLockOutputSchema,
      undefined,
      signal,
    ),
  catalogLockRetry: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.catalogLockRetry.method,
      API_ROUTES.catalogLockRetry.path,
      catalogLockOutputSchema,
      {},
      signal,
    ),
  scan: (input: z.input<typeof API_ROUTES.scan.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.scan.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.scan.method,
      queryPath(API_ROUTES.scan.path, [
        ['folder', parsed.value.folder],
        ['cached', String(parsed.value.cached)],
      ]),
      scanOutputSchema,
      undefined,
      signal,
    );
  },
  catalogTree: (input: z.input<typeof API_ROUTES.catalogTree.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.catalogTree.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.catalogTree.method,
      queryPath(API_ROUTES.catalogTree.path, [['folder', parsed.value.folder]]),
      catalogTreeOutputSchema,
      undefined,
      signal,
    );
  },
  catalogTreeFolder: (input: z.input<typeof API_ROUTES.catalogTreeFolder.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.catalogTreeFolder.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.catalogTreeFolder.method,
      queryPath(API_ROUTES.catalogTreeFolder.path, [['folder', parsed.value.folder]]),
      catalogTreeFolderOutputSchema,
      undefined,
      signal,
    );
  },
  catalogFolder: (input: z.input<typeof API_ROUTES.catalogFolder.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.catalogFolder.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.catalogFolder.method,
      queryPath(API_ROUTES.catalogFolder.path, [['folder', parsed.value.folder]]),
      catalogFolderOutputSchema,
      undefined,
      signal,
    );
  },
  catalogTreeAbsent: (input: z.input<typeof API_ROUTES.catalogTreeAbsent.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.catalogTreeAbsent.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.catalogTreeAbsent.method,
      queryPath(API_ROUTES.catalogTreeAbsent.path, [['folder', parsed.value.folder]]),
      catalogTreeAbsentOutputSchema,
      undefined,
      signal,
    );
  },
  status: (input: z.input<typeof API_ROUTES.status.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.status.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.status.method,
      queryPath(API_ROUTES.status.path, [['folder', parsed.value.folder]]),
      statusOutputSchema,
      undefined,
      signal,
    );
  },
  config: (input: z.input<typeof API_ROUTES.configGet.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.configGet.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.configGet.method,
      queryPath(API_ROUTES.configGet.path, [
        ['folder', parsed.value.folder],
        ['key', parsed.value.key],
      ]),
      configGetOutputSchema,
      undefined,
      signal,
    );
  },
  providers: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.providersList.method,
      API_ROUTES.providersList.path,
      providersListOutputSchema,
      undefined,
      signal,
    ),
  testProvider: (input: z.input<typeof API_ROUTES.providerTest.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.providerTest.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.providerTest.method,
      API_ROUTES.providerTest.path,
      providerTestOutputSchema,
      parsed.value,
      signal,
    );
  },
  modelsWhisper: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.whisperModelsList.method,
      API_ROUTES.whisperModelsList.path,
      whisperModelsListOutputSchema,
      undefined,
      signal,
    ),
  whisperRuntimeStatus: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.whisperRuntimeStatus.method,
      API_ROUTES.whisperRuntimeStatus.path,
      whisperRuntimeStatusOutputSchema,
      undefined,
      signal,
    ),
  localAiRequirements: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.localAiRequirements.method,
      API_ROUTES.localAiRequirements.path,
      localAiRequirementsOutputSchema,
      undefined,
      signal,
    ),
  doctor: (signal?: AbortSignal) =>
    request(options, API_ROUTES.doctor.method, API_ROUTES.doctor.path, doctorOutputSchema, undefined, signal),
  readiness: (input: z.input<typeof API_ROUTES.readiness.input> = {}, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.readiness.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.readiness.method,
      queryPath(API_ROUTES.readiness.path, [
        ['folder', parsed.value.folder],
        ['scope', parsed.value.scope],
        ['refresh', String(parsed.value.refresh)],
      ]),
      readinessOutputSchema,
      undefined,
      signal,
    );
  },
  check: (input: z.input<typeof API_ROUTES.check.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.check.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.check.method,
      queryPath(API_ROUTES.check.path, [['folder', parsed.value.folder]]),
      checkOutputSchema,
      undefined,
      signal,
    );
  },
  job: (input: z.input<typeof API_ROUTES.jobStatus.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.jobStatus.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.jobStatus.method,
      queryPath(API_ROUTES.jobStatus.path, [['jobId', parsed.value.jobId]]),
      jobOutputSchema,
      undefined,
      signal,
    );
  },
  jobs: (signal?: AbortSignal) =>
    request(options, API_ROUTES.jobsList.method, API_ROUTES.jobsList.path, jobsListOutputSchema, undefined, signal),
  processVideo: (input: z.input<typeof API_ROUTES.process.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.process.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.process.method,
      API_ROUTES.process.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  processDrive: (input: z.input<typeof API_ROUTES.processDrive.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.processDrive.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.processDrive.method,
      API_ROUTES.processDrive.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  materialize: (input: z.input<typeof API_ROUTES.materialize.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.materialize.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.materialize.method,
      API_ROUTES.materialize.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  generateThumbnail: (input: z.input<typeof API_ROUTES.thumbnail.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.thumbnail.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.thumbnail.method,
      API_ROUTES.thumbnail.path,
      thumbnailOutputSchema,
      parsed.value,
      signal,
    );
  },
  thumbnails: (input: z.input<typeof API_ROUTES.thumbnails.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.thumbnails.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.thumbnails.method,
      API_ROUTES.thumbnails.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  gpsBackfill: (input: z.input<typeof API_ROUTES.gpsBackfill.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.gpsBackfill.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.gpsBackfill.method,
      API_ROUTES.gpsBackfill.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  resetAll: (input: z.input<typeof API_ROUTES.resetAll.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.resetAll.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.resetAll.method,
      API_ROUTES.resetAll.path,
      resetAllOutputSchema,
      parsed.value,
      signal,
    );
  },
  resetSingle: (input: z.input<typeof API_ROUTES.resetSingle.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.resetSingle.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.resetSingle.method,
      API_ROUTES.resetSingle.path,
      resetSingleOutputSchema,
      parsed.value,
      signal,
    );
  },
  setConfig: (input: z.input<typeof API_ROUTES.configSet.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.configSet.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.configSet.method,
      API_ROUTES.configSet.path,
      configSetOutputSchema,
      parsed.value,
      signal,
    );
  },
  setCredential: (input: z.input<typeof API_ROUTES.credentialSet.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.credentialSet.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.credentialSet.method,
      API_ROUTES.credentialSet.path,
      credentialSetOutputSchema,
      parsed.value,
      signal,
    );
  },
  deleteCredential: (input: z.input<typeof API_ROUTES.credentialDelete.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.credentialDelete.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.credentialDelete.method,
      API_ROUTES.credentialDelete.path,
      credentialDeleteOutputSchema,
      parsed.value,
      signal,
    );
  },
  downloadWhisperModel: (input: z.input<typeof API_ROUTES.whisperModelDownload.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.whisperModelDownload.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.whisperModelDownload.method,
      API_ROUTES.whisperModelDownload.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  deleteWhisperModel: (input: z.input<typeof API_ROUTES.whisperModelDelete.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.whisperModelDelete.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.whisperModelDelete.method,
      API_ROUTES.whisperModelDelete.path,
      whisperModelDeleteOutputSchema,
      parsed.value,
      signal,
    );
  },
  useWhisperModel: (input: z.input<typeof API_ROUTES.whisperModelUse.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.whisperModelUse.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.whisperModelUse.method,
      API_ROUTES.whisperModelUse.path,
      whisperModelUseOutputSchema,
      parsed.value,
      signal,
    );
  },
  installWhisperRuntime: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.whisperRuntimeInstall.method,
      API_ROUTES.whisperRuntimeInstall.path,
      jobAcceptedOutputSchema,
      {},
      signal,
    ),
  pullLocalAiModel: (input: z.input<typeof API_ROUTES.localAiPull.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.localAiPull.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.localAiPull.method,
      API_ROUTES.localAiPull.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  removeLocalAiModel: (input: z.input<typeof API_ROUTES.localAiRm.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.localAiRm.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.localAiRm.method,
      API_ROUTES.localAiRm.path,
      localAiRmOutputSchema,
      parsed.value,
      signal,
    );
  },
  stopLocalAiDaemon: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.localAiDaemonStop.method,
      API_ROUTES.localAiDaemonStop.path,
      localAiDaemonStopOutputSchema,
      {},
      signal,
    ),
  cancelJob: (input: z.input<typeof API_ROUTES.jobCancel.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.jobCancel.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.jobCancel.method,
      API_ROUTES.jobCancel.path,
      jobCancelOutputSchema,
      parsed.value,
      signal,
    );
  },
  indexStatus: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.indexStatus.method,
      API_ROUTES.indexStatus.path,
      indexStatusOutputSchema,
      undefined,
      signal,
    ),
  indexRebuild: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.indexRebuild.method,
      API_ROUTES.indexRebuild.path,
      indexRebuildOutputSchema,
      {},
      signal,
    ),
  indexForget: (input: z.input<typeof API_ROUTES.indexForget.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.indexForget.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.indexForget.method,
      API_ROUTES.indexForget.path,
      indexForgetOutputSchema,
      parsed.value,
      signal,
    );
  },
  listTags: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tagsList.method,
      API_ROUTES.tagsList.path,
      tagsListOutputSchema,
      undefined,
      signal,
    ),
  catalogLocations: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.catalogLocations.method,
      API_ROUTES.catalogLocations.path,
      catalogLocationsOutputSchema,
      undefined,
      signal,
    ),
  search: (input: z.input<typeof API_ROUTES.searchQuery.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.searchQuery.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.searchQuery.method,
      queryPath(API_ROUTES.searchQuery.path, [
        ['query', parsed.value.query],
        ['limit', String(parsed.value.limit)],
        ['offset', String(parsed.value.offset)],
      ]),
      searchOutputSchema,
      undefined,
      signal,
    );
  },
  listVariants: (input: z.input<typeof API_ROUTES.variantsList.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.variantsList.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.variantsList.method,
      queryPath(API_ROUTES.variantsList.path, [
        ['videoPath', parsed.value.videoPath],
        ['fingerprint', parsed.value.fingerprint],
      ]),
      variantsListOutputSchema,
      undefined,
      signal,
    );
  },
  selectVariant: (input: z.input<typeof API_ROUTES.variantsSelect.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.variantsSelect.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.variantsSelect.method,
      API_ROUTES.variantsSelect.path,
      variantSelectOutputSchema,
      parsed.value,
      signal,
    );
  },
  deleteVariant: (input: z.input<typeof API_ROUTES.variantsDelete.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.variantsDelete.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.variantsDelete.method,
      API_ROUTES.variantsDelete.path,
      variantDeleteOutputSchema,
      parsed.value,
      signal,
    );
  },
  setFolderDefaultVariant: (
    input: z.input<typeof API_ROUTES.variantsFolderDefault.input>,
    signal?: AbortSignal,
  ) => {
    const parsed = parseInput(API_ROUTES.variantsFolderDefault.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.variantsFolderDefault.method,
      API_ROUTES.variantsFolderDefault.path,
      variantFolderDefaultOutputSchema,
      parsed.value,
      signal,
    );
  },
  aliasTag: (input: z.input<typeof API_ROUTES.tagsAlias.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.tagsAlias.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.tagsAlias.method,
      API_ROUTES.tagsAlias.path,
      tagsAliasOutputSchema,
      parsed.value,
      signal,
    );
  },
  suggestTagAliases: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tagsSuggestAliases.method,
      API_ROUTES.tagsSuggestAliases.path,
      tagsSuggestAliasesOutputSchema,
      undefined,
      signal,
    ),
  faceArtifactsStatus: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.faceArtifactsStatus.method,
      API_ROUTES.faceArtifactsStatus.path,
      faceArtifactsStatusOutputSchema,
      undefined,
      signal,
    ),
  installFaceArtifacts: (input: z.input<typeof API_ROUTES.faceArtifactsInstall.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.faceArtifactsInstall.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.faceArtifactsInstall.method,
      API_ROUTES.faceArtifactsInstall.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  facesIndex: (input: z.input<typeof API_ROUTES.facesIndex.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.facesIndex.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.facesIndex.method,
      API_ROUTES.facesIndex.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  facesPeople: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.facesPeople.method,
      API_ROUTES.facesPeople.path,
      facesPeopleOutputSchema,
      undefined,
      signal,
    ),
  facesName: (input: z.input<typeof API_ROUTES.facesName.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.facesName.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.facesName.method,
      API_ROUTES.facesName.path,
      facesNameOutputSchema,
      parsed.value,
      signal,
    );
  },
  facesMerge: (input: z.input<typeof API_ROUTES.facesMerge.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.facesMerge.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.facesMerge.method,
      API_ROUTES.facesMerge.path,
      facesMergeOutputSchema,
      parsed.value,
      signal,
    );
  },
  facesForget: (input: z.input<typeof API_ROUTES.facesForget.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.facesForget.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.facesForget.method,
      API_ROUTES.facesForget.path,
      facesForgetOutputSchema,
      parsed.value,
      signal,
    );
  },
  facesPurge: (input: z.input<typeof API_ROUTES.facesPurge.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.facesPurge.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.facesPurge.method,
      API_ROUTES.facesPurge.path,
      facesPurgeOutputSchema,
      parsed.value,
      signal,
    );
  },
  facesStatus: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.facesStatus.method,
      API_ROUTES.facesStatus.path,
      facesStatusOutputSchema,
      undefined,
      signal,
    ),
  facesRecluster: (input: z.input<typeof API_ROUTES.facesRecluster.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.facesRecluster.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.facesRecluster.method,
      API_ROUTES.facesRecluster.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  photosScan: (input: z.input<typeof API_ROUTES.photosScan.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.photosScan.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.photosScan.method,
      API_ROUTES.photosScan.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  photosStatus: (input: z.input<typeof API_ROUTES.photosStatus.input> = {}, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.photosStatus.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.photosStatus.method,
      queryPath(API_ROUTES.photosStatus.path, [['root', parsed.value.root]]),
      photosStatusOutputSchema,
      undefined,
      signal,
    );
  },
  photosForget: (input: z.input<typeof API_ROUTES.photosForget.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.photosForget.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.photosForget.method,
      API_ROUTES.photosForget.path,
      photosForgetOutputSchema,
      parsed.value,
      signal,
    );
  },
  photosProxies: (input: z.input<typeof API_ROUTES.photosProxies.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.photosProxies.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.photosProxies.method,
      API_ROUTES.photosProxies.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  photosProcess: (input: z.input<typeof API_ROUTES.photosProcess.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.photosProcess.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.photosProcess.method,
      API_ROUTES.photosProcess.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
  photosTree: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.photosTree.method,
      API_ROUTES.photosTree.path,
      photosTreeOutputSchema,
      undefined,
      signal,
    ),
  photosList: (input: z.input<typeof API_ROUTES.photosList.input> = {}, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.photosList.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.photosList.method,
      queryPath(API_ROUTES.photosList.path, [
        ['root', parsed.value.root ?? null],
        ['offset', String(parsed.value.offset)],
        ['limit', String(parsed.value.limit)],
      ]),
      photosListOutputSchema,
      undefined,
      signal,
    );
  },
  photosDetail: (input: z.input<typeof API_ROUTES.photosDetail.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.photosDetail.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.photosDetail.method,
      queryPath(API_ROUTES.photosDetail.path, [['fingerprint', parsed.value.fingerprint]]),
      photosDetailOutputSchema,
      undefined,
      signal,
    );
  },
  facesExemplars: (input: z.input<typeof API_ROUTES.facesExemplars.input>, signal?: AbortSignal) => {
    const parsed = parseInput(API_ROUTES.facesExemplars.input, input);
    if (!parsed.ok) return Promise.resolve(err(parsed.error));
    return request(
      options,
      API_ROUTES.facesExemplars.method,
      API_ROUTES.facesExemplars.path,
      jobAcceptedOutputSchema,
      parsed.value,
      signal,
    );
  },
});

export type ApiClient = ReturnType<typeof createApiClient>;

export const unwrap = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new ApiError(result.error);
  return result.value;
};

export class ApiError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = 'ApiError';
    this.appError = appError;
  }
}
