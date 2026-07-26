import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export interface MaskedPromptStreams {
  input: NodeJS.ReadableStream & { isTTY?: boolean | undefined };
  output: NodeJS.WritableStream;
  terminal?: boolean | undefined;
}

export const isInteractiveInput = (input: { isTTY?: boolean | undefined }): boolean => input.isTTY === true;

// The prompt is conversation, not output: on stderr it cannot corrupt a --json run's NDJSON.
export const promptStreams = (): MaskedPromptStreams => ({ input: process.stdin, output: process.stderr });

export interface MaskedPrompter {
  question(message: string): Promise<string>;
  secret(message: string): Promise<string>;
  close(): void;
}

class MutableOutput extends Writable {
  private muted = false;

  constructor(private readonly target: NodeJS.WritableStream) {
    super({ decodeStrings: false });
  }

  mute(): void {
    this.muted = true;
  }

  unmute(): void {
    this.muted = false;
  }

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.muted && (typeof chunk === 'string' || Buffer.isBuffer(chunk))) this.target.write(chunk);
    callback();
  }
}

export const createMaskedPrompter = (streams: MaskedPromptStreams): MaskedPrompter => {
  const output = new MutableOutput(streams.output);
  // readline infers `terminal` from the output stream, but raw mode belongs to the input:
  // with the prompt on stderr and stdout redirected, an output-derived verdict leaves the
  // input in cooked mode and the terminal driver - not readline - echoes the typed secret.
  const terminal = streams.terminal ?? isInteractiveInput(streams.input);
  const readline = createInterface({ input: streams.input, output, terminal });
  return {
    question: (message) => readline.question(message),
    secret: async (message) => {
      const answered = readline.question(message);
      output.mute();
      try {
        return (await answered).trim();
      } finally {
        output.unmute();
        streams.output.write('\n');
      }
    },
    close: () => {
      readline.close();
    },
  };
};

export const promptMaskedSecret = async (streams: MaskedPromptStreams, message: string): Promise<string> => {
  const prompter = createMaskedPrompter(streams);
  try {
    return await prompter.secret(message);
  } finally {
    prompter.close();
  }
};
