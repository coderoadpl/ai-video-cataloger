import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createMaskedPrompter, isInteractiveInput, promptMaskedSecret, promptStreams } from './masked-prompt.js';

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
  it('drives readline in terminal mode from the input stream, whatever the output is', async () => {
    const setRawMode = vi.fn();
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode });
    const { output, text } = captured();

    const answered = promptMaskedSecret({ input, output }, 'API credential: ');
    input.write('sk-live-4321\n');

    expect(await answered).toBe('sk-live-4321');
    expect(text()).toContain('API credential: ');
    expect(setRawMode).toHaveBeenCalledWith(true);
    expect(text()).not.toContain('sk-live-4321');
  });

  it('leaves a piped input alone instead of taking a terminal it does not own out of cooked mode', async () => {
    const input = new PassThrough();
    const { output, text } = captured();

    const answered = promptMaskedSecret({ input, output }, 'API credential: ');
    input.write('sk-live-9999\n');

    expect(await answered).toBe('sk-live-9999');
    expect(text()).not.toContain('\u001b[');
  });

  it('prompts on stderr so a --json run never mixes the prompt into its NDJSON', () => {
    const streams = promptStreams();

    expect(streams.output).toBe(process.stderr);
    expect(streams.input).toBe(process.stdin);
    expect(isInteractiveInput(streams.input)).toBe(process.stdin.isTTY === true);
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
