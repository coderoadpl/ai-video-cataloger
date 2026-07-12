import { describe, expect, it } from 'vitest';

import { cancelJob, enqueueProcess, getJobStatus, listJobs } from './jobs.js';
import { InMemoryJobs } from '../../../test/server/usecases/test-fakes.js';

describe('job use-cases', () => {
  it('enqueues, reads, lists, and cancels process jobs', async () => {
    const deps = { jobs: new InMemoryJobs() };

    const enqueued = await enqueueProcess(deps, {
      videoPath: '/videos/clip.mp4',
      frames: 3,
      skipRename: false,
      verbose: false,
      timeout: 120,
      whisper: 'local',
      whisperModel: 'base',
    });
    const listed = await listJobs(deps);
    const status = await getJobStatus(deps, { jobId: 'job-1' });
    const cancelled = await cancelJob(deps, { jobId: 'job-1' });

    expect(enqueued).toEqual({ ok: true, value: { jobId: 'job-1' } });
    expect(listed).toMatchObject({ ok: true, value: { jobs: [{ jobId: 'job-1', kind: 'process' }] } });
    expect(status).toMatchObject({ ok: true, value: { jobId: 'job-1', status: 'queued' } });
    expect(cancelled).toEqual({ ok: true, value: { jobId: 'job-1', cancelled: true } });
  });

  it('returns not_found for unknown job status', async () => {
    const result = await getJobStatus({ jobs: new InMemoryJobs() }, { jobId: 'missing' });

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
