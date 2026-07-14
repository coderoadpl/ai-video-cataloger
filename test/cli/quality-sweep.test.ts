import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('quality sweep invariants', () => {
  it('keeps unused generic ports out of the server vocabulary', () => {
    const ports = source('core/server/ports.ts');

    expect(ports).not.toContain('interface Clock');
    expect(ports).not.toContain('interface IdGenerator');
  });

  it('defines the persisted summary schema once', () => {
    const shared = source('core/server/usecases/shared.ts');
    const process = source('core/server/usecases/process.ts');
    const definitions = `${shared}\n${process}`.match(/(?:const|let|var) summaryDataSchema\b/g) ?? [];

    expect(definitions).toHaveLength(1);
    expect(process).toContain('summaryDataSchema,');
  });

  it('uses the domain config vocabulary in the CLI', () => {
    const cli = source('apps/cli/src/main.ts');

    expect(cli).toContain('CONFIG_KEYS,');
    expect(cli).toContain('configKeySchema,');
    expect(cli).toContain('configKeySchema.safeParse(key)');
    expect(cli).not.toContain('const CONFIG_KEYS');
  });

  it('keeps one renderer job polling implementation', () => {
    const whisper = source('apps/web/src/features/models/use-whisper-models.ts');
    const localAi = source('apps/web/src/features/models/use-local-ai.ts');

    expect(existsSync(join(root, 'apps/web/src/features/models/run-job.ts'))).toBe(false);
    expect(whisper).toContain("from '../../lib/poll-job.js'");
    expect(localAi).toContain("from '../../lib/poll-job.js'");
  });

  it('keeps architecture-restating doc blocks out of the audited renderer files', () => {
    const audited = [
      'apps/web/src/api.ts',
      'apps/web/src/lib/poll-job.ts',
      'apps/web/src/features/processing/use-processing.ts',
      'apps/web/src/features/catalog/use-catalog.ts',
      'apps/web/src/features/catalog/use-thumbnail-generation.ts',
      'apps/web/src/features/shell/use-shell.ts',
      'apps/web/src/components/ui/VideoStatusBadge.tsx',
    ];

    for (const path of audited) expect(source(path)).not.toContain('/**');
  });
});
