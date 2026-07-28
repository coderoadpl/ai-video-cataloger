import { Hono } from 'hono';
import { trace } from '@opentelemetry/api';
import { type z } from 'zod';

import { API_ROUTES, looseEnvelopeSchema } from '@core/contract/index.js';
import { appError, err, ok, type AppError, type Result } from '@core/domain/index.js';
import {
  cancelJob,
  acquireCatalogWriteLock,
  catalogLockStatus,
  checkHealth,
  checkReady,
  checkNestedDatabases,
  deleteCredential,
  deleteVariantByLocator,
  deleteWhisperModel,
  downloadWhisperModel,
  enqueueProcess,
  enqueueProcessDrive,
  faceArtifactsStatus,
  facesForget,
  facesIndex,
  facesMerge,
  facesName,
  facesPeople,
  facesPurge,
  facesStatus,
  generateThumbnail,
  installFaceArtifacts,
  getConfig,
  getJobStatus,
  getReadiness,
  getStatus,
  folderCatalogRecords,
  indexRebuild,
  indexStatus,
  forgetCatalogEntry,
  installWhisperRuntime,
  aliasTag,
  listTags,
  listJobs,
  listProviders,
  listVariants,
  listWhisperModels,
  localAiRequirements,
  pullLocalAiModel,
  removeLocalAiModel,
  resetAll,
  resetSingle,
  requireCatalogWriteLock,
  runDoctor,
  cachedScanFolder,
  scanFolder,
  scanTree,
  scanTreeFolderDetails,
  catalogTreeAbsentFiles,
  search,
  setConfig,
  setCredential,
  selectVariantByLocator,
  setFolderDefaultVariant,
  stopLocalAiDaemon,
  testProvider,
  useWhisperModel,
  whisperRuntimeStatus,
} from '@core/server/index.js';

import type { AppDeps } from './composition.js';
import { respond } from './respond.js';

type BodyReader = { req: { json(): Promise<unknown>; query(): Record<string, string> } };

const parseInput = <S extends z.ZodTypeAny>(schema: S, input: unknown): Result<z.output<S>, AppError> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return err(appError('validation', 'Request does not match the contract', parsed.error.flatten()));
  return ok(parsed.data);
};

const readBody = async (context: BodyReader): Promise<Result<unknown, AppError>> => {
  try {
    return ok(await context.req.json());
  } catch {
    return ok({});
  }
};

const withCatalogWriteLock = async <T>(
  deps: AppDeps,
  run: () => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> => {
  const lock = await requireCatalogWriteLock(deps);
  if (!lock.ok) return lock;
  const result = await run();
  const released = await deps.globalCatalog.flush();
  if (result.ok && !released.ok) return released;
  return result;
};

const withCatalogWriteLockForJob = async (
  deps: AppDeps,
  run: () => Promise<Result<{ jobId: string }, AppError>>,
): Promise<Result<{ jobId: string }, AppError>> => {
  const lease = await deps.globalCatalog.acquireLease();
  if (!lease.ok) return lease;
  const result = await run();
  if (!result.ok) {
    await deps.globalCatalog.releaseLease();
    return result;
  }
  deps.jobs.onSettled(result.value.jobId, async () => {
    await deps.globalCatalog.releaseLease();
  });
  return result;
};

const queryInput = (context: BodyReader): Record<string, string> => context.req.query();

export const buildApp = (deps: AppDeps): Hono => {
  const app = new Hono();
  const tracer = trace.getTracer('ai-video-cataloger');

  app.use('*', async (context, next) =>
    tracer.startActiveSpan('http.request', async (span) => {
      const startedAt = performance.now();
      try {
        await next();
      } finally {
        const durationMs = Math.round(performance.now() - startedAt);
        const errorCode = await responseErrorCode(context.res);
        span.setAttributes({
          route: context.req.routePath,
          durationMs,
          ...(errorCode === null ? {} : { errorCode }),
        });
        span.end();
      }
    }),
  );

  app.get(API_ROUTES.health.path, () =>
    respond(checkHealth({ version: deps.version }), API_ROUTES.health.output),
  );

  app.get(API_ROUTES.healthLive.path, () =>
    respond(checkHealth({ version: deps.version }), API_ROUTES.healthLive.output),
  );

  app.get(API_ROUTES.healthReady.path, async () =>
    respond(
      await checkReady({ version: deps.version, globalCatalog: deps.globalCatalog, config: deps.config }),
      API_ROUTES.healthReady.output,
    ),
  );

  app.get(API_ROUTES.catalogLockStatus.path, async () =>
    respond(await catalogLockStatus(deps), API_ROUTES.catalogLockStatus.output),
  );

  app.post(API_ROUTES.catalogLockRetry.path, async () =>
    respond(await acquireCatalogWriteLock(deps), API_ROUTES.catalogLockRetry.output),
  );

  app.get(API_ROUTES.scan.path, async (context) => {
    const input = parseInput(API_ROUTES.scan.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.scan.output);
    return respond(
      input.value.cached
        ? await cachedScanFolder(deps, input.value)
        : await scanFolder(deps, input.value),
      API_ROUTES.scan.output,
    );
  });

  app.get(API_ROUTES.catalogTree.path, async (context) => {
    const input = parseInput(API_ROUTES.catalogTree.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.catalogTree.output);
    return respond(await scanTree(deps, input.value), API_ROUTES.catalogTree.output);
  });

  app.get(API_ROUTES.catalogTreeFolder.path, async (context) => {
    const input = parseInput(API_ROUTES.catalogTreeFolder.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.catalogTreeFolder.output);
    return respond(await scanTreeFolderDetails(deps, input.value), API_ROUTES.catalogTreeFolder.output);
  });

  app.get(API_ROUTES.catalogFolder.path, async (context) => {
    const input = parseInput(API_ROUTES.catalogFolder.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.catalogFolder.output);
    return respond(await folderCatalogRecords(deps, input.value), API_ROUTES.catalogFolder.output);
  });

  app.get(API_ROUTES.catalogTreeAbsent.path, async (context) => {
    const input = parseInput(API_ROUTES.catalogTreeAbsent.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.catalogTreeAbsent.output);
    return respond(await catalogTreeAbsentFiles(deps, input.value), API_ROUTES.catalogTreeAbsent.output);
  });

  app.post(API_ROUTES.process.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.process.output);
    const input = parseInput(API_ROUTES.process.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.process.output);
    return respond(await withCatalogWriteLockForJob(deps, () => enqueueProcess(deps, input.value)), API_ROUTES.process.output);
  });

  app.post(API_ROUTES.processDrive.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.processDrive.output);
    const input = parseInput(API_ROUTES.processDrive.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.processDrive.output);
    return respond(await withCatalogWriteLockForJob(deps, () => enqueueProcessDrive(deps, input.value)), API_ROUTES.processDrive.output);
  });

  app.post(API_ROUTES.thumbnail.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.thumbnail.output);
    const input = parseInput(API_ROUTES.thumbnail.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.thumbnail.output);
    return respond(await generateThumbnail(deps, input.value), API_ROUTES.thumbnail.output);
  });

  app.get(API_ROUTES.status.path, async (context) => {
    const input = parseInput(API_ROUTES.status.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.status.output);
    return respond(await getStatus(deps, input.value), API_ROUTES.status.output);
  });

  app.post(API_ROUTES.resetAll.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.resetAll.output);
    const input = parseInput(API_ROUTES.resetAll.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.resetAll.output);
    return respond(await withCatalogWriteLock(deps, () => resetAll(deps, input.value)), API_ROUTES.resetAll.output);
  });

  app.post(API_ROUTES.resetSingle.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.resetSingle.output);
    const input = parseInput(API_ROUTES.resetSingle.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.resetSingle.output);
    return respond(await withCatalogWriteLock(deps, () => resetSingle(deps, input.value)), API_ROUTES.resetSingle.output);
  });

  app.get(API_ROUTES.configGet.path, async (context) => {
    const input = parseInput(API_ROUTES.configGet.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.configGet.output);
    return respond(await getConfig(deps, input.value), API_ROUTES.configGet.output);
  });

  app.post(API_ROUTES.configSet.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.configSet.output);
    const input = parseInput(API_ROUTES.configSet.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.configSet.output);
    return respond(await setConfig(deps, input.value), API_ROUTES.configSet.output);
  });

  app.post(API_ROUTES.credentialSet.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.credentialSet.output);
    const input = parseInput(API_ROUTES.credentialSet.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.credentialSet.output);
    return respond(await setCredential(deps, input.value), API_ROUTES.credentialSet.output);
  });

  app.delete(API_ROUTES.credentialDelete.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.credentialDelete.output);
    const input = parseInput(API_ROUTES.credentialDelete.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.credentialDelete.output);
    return respond(await deleteCredential(deps, input.value), API_ROUTES.credentialDelete.output);
  });

  app.get(API_ROUTES.providersList.path, () =>
    respond(listProviders(), API_ROUTES.providersList.output),
  );

  app.post(API_ROUTES.providerTest.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.providerTest.output);
    const input = parseInput(API_ROUTES.providerTest.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.providerTest.output);
    return respond(await testProvider(deps, input.value), API_ROUTES.providerTest.output);
  });

  app.get(API_ROUTES.whisperModelsList.path, async () =>
    respond(await listWhisperModels(deps), API_ROUTES.whisperModelsList.output),
  );

  app.post(API_ROUTES.whisperModelDownload.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.whisperModelDownload.output);
    const input = parseInput(API_ROUTES.whisperModelDownload.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.whisperModelDownload.output);
    return respond(await downloadWhisperModel(deps, input.value), API_ROUTES.whisperModelDownload.output);
  });

  app.delete(API_ROUTES.whisperModelDelete.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.whisperModelDelete.output);
    const input = parseInput(API_ROUTES.whisperModelDelete.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.whisperModelDelete.output);
    return respond(await deleteWhisperModel(deps, input.value), API_ROUTES.whisperModelDelete.output);
  });

  app.post(API_ROUTES.whisperModelUse.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.whisperModelUse.output);
    const input = parseInput(API_ROUTES.whisperModelUse.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.whisperModelUse.output);
    return respond(await useWhisperModel(deps, input.value), API_ROUTES.whisperModelUse.output);
  });

  app.get(API_ROUTES.whisperRuntimeStatus.path, async () =>
    respond(await whisperRuntimeStatus(deps), API_ROUTES.whisperRuntimeStatus.output),
  );

  app.post(API_ROUTES.whisperRuntimeInstall.path, async () =>
    respond(await installWhisperRuntime(deps), API_ROUTES.whisperRuntimeInstall.output),
  );

  app.get(API_ROUTES.localAiRequirements.path, async () =>
    respond(await localAiRequirements(deps), API_ROUTES.localAiRequirements.output),
  );

  app.post(API_ROUTES.localAiPull.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.localAiPull.output);
    const input = parseInput(API_ROUTES.localAiPull.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.localAiPull.output);
    return respond(await pullLocalAiModel(deps, input.value), API_ROUTES.localAiPull.output);
  });

  app.delete(API_ROUTES.localAiRm.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.localAiRm.output);
    const input = parseInput(API_ROUTES.localAiRm.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.localAiRm.output);
    return respond(await removeLocalAiModel(deps, input.value), API_ROUTES.localAiRm.output);
  });

  app.post(API_ROUTES.localAiDaemonStop.path, async () =>
    respond(await stopLocalAiDaemon(deps), API_ROUTES.localAiDaemonStop.output),
  );

  app.get(API_ROUTES.doctor.path, async () =>
    respond(await runDoctor(deps), API_ROUTES.doctor.output),
  );

  app.get(API_ROUTES.readiness.path, async (context) => {
    const input = parseInput(API_ROUTES.readiness.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.readiness.output);
    return respond(await getReadiness(deps, input.value), API_ROUTES.readiness.output);
  });

  app.get(API_ROUTES.check.path, async (context) => {
    const input = parseInput(API_ROUTES.check.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.check.output);
    return respond(await checkNestedDatabases(deps, input.value), API_ROUTES.check.output);
  });

  app.get(API_ROUTES.jobStatus.path, async (context) => {
    const input = parseInput(API_ROUTES.jobStatus.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.jobStatus.output);
    return respond(await getJobStatus(deps, input.value), API_ROUTES.jobStatus.output);
  });

  app.get(API_ROUTES.jobsList.path, async () =>
    respond(await listJobs(deps), API_ROUTES.jobsList.output),
  );

  app.post(API_ROUTES.jobCancel.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.jobCancel.output);
    const input = parseInput(API_ROUTES.jobCancel.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.jobCancel.output);
    return respond(await cancelJob(deps, input.value), API_ROUTES.jobCancel.output);
  });

  app.get(API_ROUTES.indexStatus.path, async () =>
    respond(await indexStatus(deps), API_ROUTES.indexStatus.output),
  );

  app.post(API_ROUTES.indexRebuild.path, async () => {
    return respond(await withCatalogWriteLock(deps, () => indexRebuild(deps)), API_ROUTES.indexRebuild.output);
  });

  app.post(API_ROUTES.indexForget.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.indexForget.output);
    const input = parseInput(API_ROUTES.indexForget.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.indexForget.output);
    return respond(await withCatalogWriteLock(deps, () => forgetCatalogEntry(deps, input.value)), API_ROUTES.indexForget.output);
  });

  app.get(API_ROUTES.tagsList.path, async () =>
    respond(await listTags(deps), API_ROUTES.tagsList.output),
  );

  app.post(API_ROUTES.tagsAlias.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.tagsAlias.output);
    const input = parseInput(API_ROUTES.tagsAlias.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.tagsAlias.output);
    return respond(await withCatalogWriteLock(deps, () => aliasTag(deps, input.value)), API_ROUTES.tagsAlias.output);
  });

  app.get(API_ROUTES.searchQuery.path, async (context) => {
    const input = parseInput(API_ROUTES.searchQuery.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.searchQuery.output);
    return respond(await search(deps, input.value), API_ROUTES.searchQuery.output);
  });

  app.get(API_ROUTES.variantsList.path, async (context) => {
    const input = parseInput(API_ROUTES.variantsList.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.variantsList.output);
    return respond(await listVariants(deps, input.value), API_ROUTES.variantsList.output);
  });

  app.post(API_ROUTES.variantsSelect.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.variantsSelect.output);
    const input = parseInput(API_ROUTES.variantsSelect.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.variantsSelect.output);
    return respond(
      await withCatalogWriteLock(deps, () => selectVariantByLocator(deps, input.value)),
      API_ROUTES.variantsSelect.output,
    );
  });

  app.post(API_ROUTES.variantsDelete.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.variantsDelete.output);
    const input = parseInput(API_ROUTES.variantsDelete.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.variantsDelete.output);
    return respond(
      await withCatalogWriteLock(deps, () => deleteVariantByLocator(deps, input.value)),
      API_ROUTES.variantsDelete.output,
    );
  });

  app.post(API_ROUTES.variantsFolderDefault.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.variantsFolderDefault.output);
    const input = parseInput(API_ROUTES.variantsFolderDefault.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.variantsFolderDefault.output);
    return respond(
      await withCatalogWriteLock(deps, () => setFolderDefaultVariant(deps, input.value)),
      API_ROUTES.variantsFolderDefault.output,
    );
  });

  app.get(API_ROUTES.faceArtifactsStatus.path, async () =>
    respond(await faceArtifactsStatus(deps), API_ROUTES.faceArtifactsStatus.output),
  );

  app.post(API_ROUTES.faceArtifactsInstall.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.faceArtifactsInstall.output);
    const input = parseInput(API_ROUTES.faceArtifactsInstall.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.faceArtifactsInstall.output);
    return respond(await installFaceArtifacts(deps, input.value), API_ROUTES.faceArtifactsInstall.output);
  });

  app.post(API_ROUTES.facesIndex.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.facesIndex.output);
    const input = parseInput(API_ROUTES.facesIndex.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.facesIndex.output);
    return respond(await withCatalogWriteLockForJob(deps, () => facesIndex(deps, input.value)), API_ROUTES.facesIndex.output);
  });

  app.get(API_ROUTES.facesPeople.path, async () =>
    respond(await facesPeople(deps), API_ROUTES.facesPeople.output),
  );

  app.post(API_ROUTES.facesName.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.facesName.output);
    const input = parseInput(API_ROUTES.facesName.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.facesName.output);
    return respond(await withCatalogWriteLock(deps, () => facesName(deps, input.value)), API_ROUTES.facesName.output);
  });

  app.post(API_ROUTES.facesMerge.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.facesMerge.output);
    const input = parseInput(API_ROUTES.facesMerge.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.facesMerge.output);
    return respond(await withCatalogWriteLock(deps, () => facesMerge(deps, input.value)), API_ROUTES.facesMerge.output);
  });

  app.post(API_ROUTES.facesForget.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.facesForget.output);
    const input = parseInput(API_ROUTES.facesForget.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.facesForget.output);
    return respond(await withCatalogWriteLock(deps, () => facesForget(deps, input.value)), API_ROUTES.facesForget.output);
  });

  app.post(API_ROUTES.facesPurge.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.facesPurge.output);
    const input = parseInput(API_ROUTES.facesPurge.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.facesPurge.output);
    return respond(await withCatalogWriteLock(deps, () => facesPurge(deps, input.value)), API_ROUTES.facesPurge.output);
  });

  app.get(API_ROUTES.facesStatus.path, async () =>
    respond(await facesStatus(deps), API_ROUTES.facesStatus.output),
  );

  return app;
};

const responseErrorCode = async (response: Response): Promise<string | null> => {
  if (response.status < 400) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  try {
    const payload: unknown = await response.clone().json();
    const parsed = looseEnvelopeSchema.safeParse(payload);
    if (!parsed.success || parsed.data.ok) return null;
    return parsed.data.error.code;
  } catch {
    return null;
  }
};
