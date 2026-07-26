import { describe, expect, it } from 'vitest';

import { credentialDeleteHuman } from './credential-delete-human.js';

describe('credentialDeleteHuman', () => {
  it('names every backend it cleared', () => {
    const output = credentialDeleteHuman({
      providerId: 'openai',
      cleared: ['keychain', 'file'],
      retained: [],
    });

    expect(output).toBe(
      'Cleared the credential for openai from the macOS Keychain'
      + ' and the config file (~/.ai-video-cataloger/credentials.json)',
    );
  });

  it('says partial when the keychain kept the credential', () => {
    const output = credentialDeleteHuman({
      providerId: 'openai',
      cleared: ['file'],
      retained: ['keychain'],
    });

    expect(output.split('\n')).toEqual([
      'Cleared the credential for openai from the config file (~/.ai-video-cataloger/credentials.json)',
      'Partial: the macOS Keychain still holds the credential.'
      + ' Unlock the login keychain and run this command again.',
    ]);
  });

  it('reports a provider that had nothing stored', () => {
    const output = credentialDeleteHuman({ providerId: 'gemini', cleared: [], retained: [] });

    expect(output).toBe('No stored credential for gemini');
  });
});
