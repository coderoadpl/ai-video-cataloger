import { describe, expect, it } from 'vitest';

import { appError, type AppError, type Result } from '@core/domain/index.js';
import { enqueueProcess, type JobRecord, type ProcessDeps } from '@core/server/index.js';
import {
  InMemoryAnalyzer,
  InMemoryCatalogs,
  InMemoryConfig,
  InMemoryFileSystem,
  InMemoryMedia,
  InMemoryTranscriber,
  videoFixture,
} from '../../test/server/usecases/test-fakes.js';

import { InProcessJobsPort } from './index.js';
import { scaledTimeout } from '../../test/helpers/gate-timeout.js';

const videoPath = '/work/Clip One.mp4';
const baseInput = {
  videoPath,
  frames: 3,
  skipRename: false,
  verbose: false,
  timeout: 120,
  whisper: 'local',
  whisperModel: 'base',
} as const;

class SlowAbortableMedia extends InMemoryMedia {
  aborted = false;
  private startedResolve: (() => void) | undefined;
  readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve;
  });

  override extractFrames(input: {
    videoPath: string;
    outputDirectory: string;
    frameCount: number;
    signal?: AbortSignal | undefined;
  }): Promise<Result<{ framePaths: string[] }, AppError>> {
    this.frameInputs.push(input);
    this.startedResolve?.();
    return new Promise((resolve) => {
      const abort = (): void => {
        this.aborted = true;
        resolve({ ok: false, error: appError('processing_error', 'frame extraction aborted') });
      };
      if (input.signal?.aborted === true) abort();
      else input.signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

const makeDeps = (): ProcessDeps & {
  fs: InMemoryFileSystem;
  catalogs: InMemoryCatalogs;
  config: InMemoryConfig;
  media: InMemoryMedia;
  transcriber: InMemoryTranscriber;
  analyzer: InMemoryAnalyzer;
} => {
  const fs = new InMemoryFileSystem('/work');
  fs.addFile(videoPath, {
    size: 1000,
    mtimeMs: new Date('2024-05-06T12:00:00.000Z').getTime(),
    hash: 'hash-clip',
  });
  const catalogs = new InMemoryCatalogs([
    {
      folder: '/work',
      videos: [videoFixture({ originalPath: videoPath, originalName: 'Clip One.mp4', fileHash: 'hash-clip', status: 'pending' })],
    },
  ]);
  return {
    catalogs,
    config: new InMemoryConfig(),
    fs,
    media: new InMemoryMedia(),
    transcriber: new InMemoryTranscriber(fs),
    analyzer: new InMemoryAnalyzer(),
  };
};

describe('process pipeline through the in-process jobs executor', () => {
  it('aborts a slow child step and leaves the catalog non-completed until the job settles', async () => {
    const deps = makeDeps();
    const slowMedia = new SlowAbortableMedia();
    deps.media = slowMedia;
    const jobs = new InProcessJobsPort();
    const enqueued = await enqueueProcess({ ...deps, jobs }, baseInput);
    if (!enqueued.ok) throw new Error(enqueued.error.message);
    await slowMedia.started;

    const cancelled = await jobs.cancel(enqueued.value.jobId);
    const settling = await readJob(jobs, enqueued.value.jobId);
    const terminal = await waitForRecord(jobs, enqueued.value.jobId, (record) => record.status === 'cancelled');
    const videos = await deps.catalogs.repo('/work').listVideos();

    expect(cancelled).toMatchObject({ ok: true, value: { cancelled: true } });
    expect(settling.status).toBe('running');
    expect(slowMedia.aborted).toBe(true);
    expect(terminal.status).toBe('cancelled');
    expect(videos).toMatchObject({ ok: true, value: [{ status: 'pending' }] });
    expect(deps.media.audioInputs).toHaveLength(0);
    expect(deps.transcriber.inputs).toHaveLength(0);
    expect(deps.analyzer.inputs).toHaveLength(0);
    await expect(deps.fs.exists('/work/summaries/Clip One.json')).resolves.toEqual({ ok: true, value: false });
  }, scaledTimeout(30_000));
});

const waitForRecord = async (
  jobs: InProcessJobsPort,
  jobId: string,
  matches: (record: JobRecord) => boolean,
): Promise<JobRecord> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = await readJob(jobs, jobId);
    if (matches(record)) return record;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error(`Timed out waiting for ${jobId}`);
};

const readJob = async (jobs: InProcessJobsPort, jobId: string): Promise<JobRecord> => {
  const result = await jobs.get(jobId);
  if (!result.ok) throw new Error(result.error.message);
  if (result.value === null) throw new Error(`Missing job ${jobId}`);
  return result.value;
};
