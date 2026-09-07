import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runBenchmark, buildFixtureCorpus } from '@core/domain/index.js';
import { emitFacesBenchmark } from './output.js';

afterEach(() => vi.restoreAllMocks());

it('PE17 emits one parseable benchmark line in JSON mode and only a table in human mode', () => {
  const report = runBenchmark(buildFixtureCorpus([], []), [0.56]);
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  emitFacesBenchmark(true, report);
  expect(write).toHaveBeenCalledTimes(1);
  const output = z.string().parse(write.mock.calls[0]?.[0]);
  expect(output.trim().split('\n')).toHaveLength(1);
  expect(JSON.parse(output)).toMatchObject({ type: 'faces_benchmark', data: report });
  write.mockClear();
  emitFacesBenchmark(false, report);
  expect(write).toHaveBeenCalledTimes(1);
  expect(z.string().parse(write.mock.calls[0]?.[0])).not.toContain('"type"');
});
