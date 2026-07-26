import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createMaskedPrompter, promptMaskedSecret } from './masked-prompt.js';

const captured = (): { output: PassThrough; text: () => string } => {
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString('utf8'));
  });
  return { output, text: () => chunks.join('') };
};

describe('promptMaskedSecret', () => {
  it('returns the typed secret without echoing it to the terminal', async () => {
    const input = new PassThrough();
    const { output, text } = captured();

    const answered = promptMaskedSecret({ input, output, terminal: true }, 'API credential: ');
    input.write('sk-live-1234\n');

    expect(await answered).toBe('sk-live-1234');
    expect(text()).toContain('API credential: ');
    expect(text()).not.toContain('sk-live-1234');
    expect(text()).not.toContain('sk-live');
  });
});

describe('terminal detection', () => {
  it('drives readline in terminal mode when the real output is a TTY, so the driver never echoes', async () => {
    const input = new PassThrough();
    const { output, text } = captured();
    const tty = Object.assign(output, { isTTY: true });

    const answered = promptMaskedSecret({ input, output: tty }, 'API credential: ');
    input.write('sk-live-4321\n');

    expect(await answered).toBe('sk-live-4321');
    expect(text()).toContain('API credential: ');
    expect(text()).not.toContain('sk-live-4321');
  });
});

describe('createMaskedPrompter', () => {
  it('keeps echoing plain questions while masking secrets on the same stream', async () => {
    const input = new PassThrough();
    const { output, text } = captured();
    const prompter = createMaskedPrompter({ input, output, terminal: true });

    const name = prompter.question('Folder: ');
    input.write('/videos\n');
    expect(await name).toBe('/videos');

    const secret = prompter.secret('API credential: ');
    input.write('sk-live-5678\n');
    expect(await secret).toBe('sk-live-5678');
    prompter.close();

    expect(text()).toContain('/videos');
    expect(text()).not.toContain('sk-live-5678');
  });
});
