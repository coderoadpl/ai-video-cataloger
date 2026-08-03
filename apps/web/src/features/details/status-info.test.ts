import { describe, expect, it } from 'vitest';

import type { z } from 'zod';

import type { scanVideoSchema } from '@core/contract/index.js';

import { en, pl } from '../../i18n/dictionary.js';
import { statusDescription } from './status-info.js';

type DetailsVideo = z.output<typeof scanVideoSchema>;

const makeArtifacts = (
  overrides: Partial<DetailsVideo['artifacts']> = {},
): DetailsVideo['artifacts'] => ({
  framePaths: null,
  transcriptContent: null,
  transcriptPath: null,
  summary: null,
  summaryPath: null,
  thumbnailPath: null,
  thumbnailMtime: null,
  newFilename: null,
  ...overrides,
});

describe('statusDescription — completed copy reflects the variant artifacts', () => {
  it('promises transcript and frames only when both are present', () => {
    const artifacts = makeArtifacts({
      transcriptContent: 'hello world',
      framePaths: ['/frames/1.jpg'],
    });

    expect(statusDescription(en, 'completed', false, artifacts)).toBe(
      'Analysis complete. Summary, transcript, and frames are available.',
    );
    expect(statusDescription(pl, 'completed', false, artifacts)).toBe(
      'Analiza zakończona. Streszczenie, transkrypcja i klatki są dostępne.',
    );
  });

  it('drops the transcript promise for a whisper-skip variant (no transcript, has frames)', () => {
    const artifacts = makeArtifacts({ framePaths: ['/frames/1.jpg'] });

    const en_result = statusDescription(en, 'completed', false, artifacts);
    const pl_result = statusDescription(pl, 'completed', false, artifacts);

    expect(en_result).toBe('Analysis complete. Summary and frames are available.');
    expect(en_result).not.toContain('transcript');
    expect(pl_result).toBe('Analiza zakończona. Streszczenie i klatki są dostępne.');
    expect(pl_result).not.toContain('transkrypcja');
  });

  it('drops the frames promise for a native variant (has transcript, no frames)', () => {
    const artifacts = makeArtifacts({ transcriptContent: 'hello world', framePaths: [] });

    const en_result = statusDescription(en, 'completed', false, artifacts);
    const pl_result = statusDescription(pl, 'completed', false, artifacts);

    expect(en_result).toBe('Analysis complete. Summary and transcript are available.');
    expect(en_result).not.toContain('frames');
    expect(pl_result).toBe('Analiza zakończona. Streszczenie i transkrypcja są dostępne.');
    expect(pl_result).not.toContain('klatki');
  });

  it('promises only the summary when neither transcript nor frames are present', () => {
    const artifacts = makeArtifacts();

    expect(statusDescription(en, 'completed', false, artifacts)).toBe(
      'Analysis complete. Summary is available.',
    );
    expect(statusDescription(pl, 'completed', false, artifacts)).toBe(
      'Analiza zakończona. Streszczenie jest dostępne.',
    );
  });
});
