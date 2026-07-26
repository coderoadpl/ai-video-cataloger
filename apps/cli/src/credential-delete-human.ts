import {
  CREDENTIALS_BACKEND_LABELS,
  type CredentialDeletion,
  type CredentialsBackend,
} from '@core/domain/index.js';

const keychainRetainedLine = 'Partial: the macOS Keychain still holds the credential.'
  + ' Unlock the login keychain and run this command again.';

const keychainHoldsLine = (providerId: string): string =>
  `The ${CREDENTIALS_BACKEND_LABELS.keychain} still holds the credential for ${providerId}.`
  + ' Unlock the login keychain and run this command again.';

const labelList = (backends: readonly CredentialsBackend[]): string =>
  backends.map((backend) => `the ${CREDENTIALS_BACKEND_LABELS[backend]}`).join(' and ');

export const credentialDeleteHuman = (data: { providerId: string } & CredentialDeletion): string => {
  if (data.unreadableEntry !== undefined && data.cleared.length === 0) {
    return [
      `The entry for ${data.providerId} in ${data.unreadableEntry} could not be read, so nothing was removed.`
      + ' Fix or remove that entry by hand.',
      ...(data.retained.includes('keychain') ? [keychainHoldsLine(data.providerId)] : []),
    ].join('\n');
  }
  if (data.unreadableEntry !== undefined) {
    return [
      `Cleared the credential for ${data.providerId} from ${labelList(data.cleared)}`,
      ...(data.retained.includes('keychain') ? [keychainRetainedLine] : []),
      `The entry for ${data.providerId} in ${data.unreadableEntry} could not be read and was left untouched.`
      + ' Fix or remove that entry by hand.',
    ].join('\n');
  }
  if (data.cleared.length === 0 && data.retained.length === 0) {
    return `No stored credential for ${data.providerId}`;
  }
  if (data.cleared.length === 0) {
    return (
      `Nothing was cleared: ${labelList(data.retained)} still holds the credential for ${data.providerId}.`
      + ' Unlock the login keychain and run this command again.'
    );
  }
  const lines = [`Cleared the credential for ${data.providerId} from ${labelList(data.cleared)}`];
  if (data.retained.length > 0) {
    lines.push(
      `Partial: ${labelList(data.retained)} still holds the credential.`
      + ' Unlock the login keychain and run this command again.',
    );
  }
  return lines.join('\n');
};
