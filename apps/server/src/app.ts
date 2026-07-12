import { Hono } from 'hono';
import { type z } from 'zod';

import { API_ROUTES, HTTP_STATUS_BY_ERROR_CODE, toEnvelope } from '@core/contract/index.js';
import { appError, err, ok, type AppError, type Result } from '@core/domain/index.js';
import {
  cancelJob,
  checkHealth,
  checkNestedDatabases,
  deleteWhisperModel,
  downloadWhisperModel,
  enqueueProcess,
  generateThumbnail,
  getConfig,
  getJobStatus,
  getStatus,
  listJobs,
  listWhisperModels,
  localAiRequirements,
  pullLocalAiModel,
  removeLocalAiModel,
  resetAll,
  resetSingle,
  runDoctor,
  scanFolder,
  setConfig,
  stopLocalAiDaemon,
  useWhisperModel,
} from '@core/server/index.js';

import type { AppDeps } from './composition.js';

type BodyReader = { req: { json(): Promise<unknown>; query(): Record<string, string> } };

const respond = (result: Result<unknown, AppError>, outputSchema: z.ZodTypeAny): Response => {
  const parsed = result.ok ? outputSchema.safeParse(result.value) : null;
  const finalResult =
    result.ok && parsed !== null && !parsed.success
      ? err(appError('internal', 'Response data does not match the contract'))
      : result;
  const envelope = toEnvelope(finalResult);
  const status = envelope.ok ? 200 : HTTP_STATUS_BY_ERROR_CODE[envelope.error.code];
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { 'content-type': 'application/json' },
  });
};

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

const queryInput = (context: BodyReader): Record<string, string> => context.req.query();

export const buildApp = (deps: AppDeps): Hono => {
  const app = new Hono();

  app.get(API_ROUTES.health.path, () =>
    respond(checkHealth({ version: deps.version }), API_ROUTES.health.output),
  );

  app.get(API_ROUTES.scan.path, async (context) => {
    const input = parseInput(API_ROUTES.scan.input, queryInput(context));
    if (!input.ok) return respond(input, API_ROUTES.scan.output);
    return respond(await scanFolder(deps, input.value), API_ROUTES.scan.output);
  });

  app.post(API_ROUTES.process.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.process.output);
    const input = parseInput(API_ROUTES.process.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.process.output);
    return respond(await enqueueProcess(deps, input.value), API_ROUTES.process.output);
  });

  app.post(API_ROUTES.thumbnail.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.thumbnail.output);
    const input = parseInput(API_ROUTES.thumbnail.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.thumbnail.output);
    return respond(await generateThumbnail(deps, input.value), API_ROUTES.thumbnail.output);
  });

  app.get(API_ROUTES.status.path, async () =>
    respond(await getStatus(deps), API_ROUTES.status.output),
  );

  app.post(API_ROUTES.resetAll.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.resetAll.output);
    const input = parseInput(API_ROUTES.resetAll.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.resetAll.output);
    return respond(await resetAll(deps, input.value), API_ROUTES.resetAll.output);
  });

  app.post(API_ROUTES.resetSingle.path, async (context) => {
    const body = await readBody(context);
    if (!body.ok) return respond(body, API_ROUTES.resetSingle.output);
    const input = parseInput(API_ROUTES.resetSingle.input, body.value);
    if (!input.ok) return respond(input, API_ROUTES.resetSingle.output);
    return respond(await resetSingle(deps, input.value), API_ROUTES.resetSingle.output);
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

  return app;
};
