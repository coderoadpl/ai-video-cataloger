/**
 * Unit tests for the Ollama HTTP client against a local mock server.
 * No network, no real Ollama.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  chatVision, deleteModel, isModelInstalled, listModels, pullModel,
} from '../src/services/ollama-client.js';
import { CodedError } from '../src/services/json-output.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';

    if (url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        models: [
          { name: 'gemma3:4b', size: 3_300_000_000 },
          { name: 'qwen2.5vl:7b', size: 6_000_000_000 },
        ],
      }));
      return;
    }

    if (url === '/api/pull') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const { model } = JSON.parse(body) as { model: string };
        res.setHeader('content-type', 'application/x-ndjson');
        if (model === 'nope:missing') {
          res.end(JSON.stringify({ error: 'pull model manifest: file does not exist' }) + '\n');
          return;
        }
        res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
        res.write(JSON.stringify({ status: 'downloading', total: 1000, completed: 250 }) + '\n');
        res.write(JSON.stringify({ status: 'downloading', total: 1000, completed: 1000 }) + '\n');
        res.end(JSON.stringify({ status: 'success' }) + '\n');
      });
      return;
    }

    if (url === '/api/delete') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const { model } = JSON.parse(body) as { model: string };
        if (model === 'nope:missing') {
          res.statusCode = 404;
          res.end('{}');
          return;
        }
        res.end('{}');
      });
      return;
    }

    if (url === '/api/chat') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body) as {
          model: string;
          messages: Array<{ content: string; images?: string[] }>;
        };
        if (parsed.model === 'nope:missing') {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: `model "${parsed.model}" not found` }));
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          message: {
            role: 'assistant',
            content:
              `DESCRIPTION: Saw ${parsed.messages[0].images?.length ?? 0} images.\n` +
              'FILENAME: mock-video-name',
          },
        }));
      });
      return;
    }

    res.statusCode = 500;
    res.end('unknown');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('ollama-client', () => {
  it('lists installed models', async () => {
    const models = await listModels(baseUrl);
    expect(models.map((m) => m.name)).toEqual(['gemma3:4b', 'qwen2.5vl:7b']);
    expect(models[0].sizeBytes).toBeGreaterThan(0);
  });

  it('detects installed models incl. :latest normalization', async () => {
    expect(await isModelInstalled(baseUrl, 'gemma3:4b')).toBe(true);
    expect(await isModelInstalled(baseUrl, 'gemma3:12b')).toBe(false);
  });

  it('streams pull progress with computed percentages', async () => {
    const seen: Array<number | null> = [];
    await pullModel(baseUrl, 'gemma3:4b', (progress) => seen.push(progress.percent));
    expect(seen).toContain(25);
    expect(seen).toContain(100);
    expect(seen[0]).toBeNull(); // manifest step has no total
  });

  it('maps pull errors for unknown models to MODEL_NOT_INSTALLED', async () => {
    await expect(pullModel(baseUrl, 'nope:missing')).rejects.toMatchObject({
      code: 'MODEL_NOT_INSTALLED',
    });
  });

  it('deletes models and maps 404 to MODEL_NOT_INSTALLED', async () => {
    await expect(deleteModel(baseUrl, 'gemma3:4b')).resolves.toBeUndefined();
    await expect(deleteModel(baseUrl, 'nope:missing')).rejects.toMatchObject({
      code: 'MODEL_NOT_INSTALLED',
    });
  });

  it('chatVision sends images and returns the assistant content', async () => {
    const content = await chatVision(baseUrl, {
      model: 'gemma3:4b',
      prompt: 'describe',
      imagesBase64: ['aGVsbG8=', 'd29ybGQ='],
      timeoutMs: 5_000,
    });
    expect(content).toContain('Saw 2 images');
    expect(content).toContain('FILENAME: mock-video-name');
  });

  it('chatVision maps unknown model to MODEL_NOT_INSTALLED with pull hint', async () => {
    await expect(
      chatVision(baseUrl, { model: 'nope:missing', prompt: 'x', imagesBase64: [], timeoutMs: 5_000 })
    ).rejects.toMatchObject({ code: 'MODEL_NOT_INSTALLED' });
  });

  it('maps unreachable runtime to OLLAMA_UNAVAILABLE', async () => {
    const dead = 'http://127.0.0.1:9';
    await expect(listModels(dead)).rejects.toBeInstanceOf(CodedError);
    await expect(listModels(dead)).rejects.toMatchObject({ code: 'OLLAMA_UNAVAILABLE' });
  });
});
