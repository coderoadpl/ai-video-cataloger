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

  it('says nothing was cleared when only the keychain held the credential and refused', () => {
    const output = credentialDeleteHuman({ providerId: 'openai', cleared: [], retained: ['keychain'] });

    expect(output).toBe(
      'Nothing was cleared: the macOS Keychain still holds the credential for openai.'
      + ' Unlock the login keychain and run this command again.',
    );
  });

  it('says nothing was removed when an unreadable entry was all there was', () => {
    const output = credentialDeleteHuman({
      providerId: 'gemini',
      cleared: [],
      retained: ['file'],
      unreadableEntry: '/home/u/.ai-video-cataloger/credentials.json',
    });

    expect(output).toBe(
      'The entry for gemini in /home/u/.ai-video-cataloger/credentials.json could not be read,'
      + ' so nothing was removed. Fix or remove that entry by hand.',
    );
  });

  it('names what it did clear when an unreadable entry survived alongside it', () => {
    const output = credentialDeleteHuman({
      providerId: 'gemini',
      cleared: ['keychain'],
      retained: ['file'],
      unreadableEntry: '/home/u/.ai-video-cataloger/credentials.json',
    });

    expect(output.split('\n')).toEqual([
      'Cleared the credential for gemini from the macOS Keychain',
      'The entry for gemini in /home/u/.ai-video-cataloger/credentials.json could not be read and was left untouched.'
      + ' Fix or remove that entry by hand.',
    ]);
  });

  it('still warns about the keychain when an unreadable entry joins a retained keychain', () => {
    const output = credentialDeleteHuman({
      providerId: 'gemini',
      cleared: ['file'],
      retained: ['keychain'],
      unreadableEntry: '/home/u/.ai-video-cataloger/credentials.json',
    });

    expect(output.split('\n')).toEqual([
      'Cleared the credential for gemini from the config file (~/.ai-video-cataloger/credentials.json)',
      'Partial: the macOS Keychain still holds the credential.'
      + ' Unlock the login keychain and run this command again.',
      'The entry for gemini in /home/u/.ai-video-cataloger/credentials.json could not be read and was left untouched.'
      + ' Fix or remove that entry by hand.',
    ]);
  });

  it('reports a provider that had nothing stored', () => {
    const output = credentialDeleteHuman({ providerId: 'gemini', cleared: [], retained: [] });

    expect(output).toBe('No stored credential for gemini');
  });
});
