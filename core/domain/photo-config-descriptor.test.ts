import { describe, expect, it } from 'vitest';

import {
  buildConfigDescriptor,
  buildPhotoConfigDescriptor,
  configId,
  photoConfigDescriptorSchema,
  photoConfigId,
  type ConfigInput,
} from './index.js';

const promptVersion = 1;

describe('photo config descriptor identity', () => {
  it('is closed and enforces the per-family analyzer field matrix', () => {
    const base = buildPhotoConfigDescriptor({
      analyzer_provider: { family: 'api', providerId: 'openai', baseUrl: 'https://api.openai.com/v1', apiKeyRef: 'ref', model: 'gpt-5.5', maxImageDetail: 'high' },
    }, promptVersion);
    expect(photoConfigDescriptorSchema.safeParse({ ...base, whisper_mode: 'skip' }).success).toBe(false);
    expect(photoConfigDescriptorSchema.safeParse({ ...base, frames: 3 }).success).toBe(false);
    expect(photoConfigDescriptorSchema.safeParse({ ...base, maxImageDetail: undefined }).success).toBe(false);
  });

  it.each([
    { family: 'api' as const, input: { analyzer_provider: { family: 'api' as const, providerId: 'openai', baseUrl: 'https://api.openai.com/v1', apiKeyRef: 'ref', model: 'gpt-5.5', maxImageDetail: 'high' as const } } },
    { family: 'harness' as const, input: { analyzer_provider: { family: 'harness' as const, providerId: 'codex', command: 'codex', argsTemplate: ['--add-dir', '{videoDir}', '{prompt}'], promptStyle: 'dir-access' as const } } },
    { family: 'local' as const, input: { analyzer_provider: { family: 'local' as const, providerId: 'local', modelTag: 'gemma3:12b' } } },
    { family: 'gemini-native' as const, input: { analyzer_provider: { family: 'gemini-native' as const, providerId: 'gemini', apiKeyRef: 'gemini', model: 'gemini-3.6-flash' } } },
  ] satisfies readonly { family: string; input: ConfigInput }[])('rejects whisper_mode and frames for every family ($family)', ({ input }) => {
    const descriptor = buildPhotoConfigDescriptor(input, promptVersion);
    expect(photoConfigDescriptorSchema.safeParse({ ...descriptor, whisper_mode: 'local' }).success).toBe(false);
    expect(photoConfigDescriptorSchema.safeParse({ ...descriptor, frames: 5 }).success).toBe(false);
  });

  it('mirrors the tag_language omission rule', () => {
    const withoutTagLanguage = buildPhotoConfigDescriptor({ output_language: 'pl' }, promptVersion);
    expect(withoutTagLanguage.tag_language).toBe('pl');
    const defaultDescriptor = buildPhotoConfigDescriptor({}, promptVersion);
    expect(defaultDescriptor.tag_language).toBeUndefined();
  });

  it('is stable for the same descriptor and changes when a field or the prompt version changes', () => {
    const base = buildPhotoConfigDescriptor({}, promptVersion);
    expect(photoConfigId(base)).toBe(photoConfigId(buildPhotoConfigDescriptor({}, promptVersion)));
    expect(photoConfigId(base)).not.toBe(photoConfigId(buildPhotoConfigDescriptor({}, promptVersion + 1)));
    expect(photoConfigId(base)).not.toBe(photoConfigId(buildPhotoConfigDescriptor({ output_language: 'pl' }, promptVersion)));
  });

  it('never collides with a video configId built from the same provider inputs', () => {
    const input: ConfigInput = { analyzer_provider: { family: 'gemini-native', providerId: 'gemini', apiKeyRef: 'ref', model: 'gemini-3.6-flash' } };
    const photoId = photoConfigId(buildPhotoConfigDescriptor(input, promptVersion));
    const videoId = configId(buildConfigDescriptor(input, promptVersion));
    expect(photoId).not.toBe(videoId);
  });

  it('carries the kind literal and rejects it being absent', () => {
    const descriptor = buildPhotoConfigDescriptor({}, promptVersion);
    expect(descriptor).toMatchObject({ kind: 'photo' });
    expect(photoConfigDescriptorSchema.safeParse({ ...descriptor, kind: undefined }).success).toBe(false);
  });
});
