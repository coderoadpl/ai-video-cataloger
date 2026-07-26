import {
  CREDENTIALS_BACKEND_LABELS,
  type CredentialDeletion,
  type CredentialsBackend,
} from '@core/domain/index.js';

const labelList = (backends: readonly CredentialsBackend[]): string =>
  backends.map((backend) => `the ${CREDENTIALS_BACKEND_LABELS[backend]}`).join(' and ');

export const credentialDeleteHuman = (data: { providerId: string } & CredentialDeletion): string => {
  const lines: string[] = [];
  if (data.cleared.length === 0) {
    lines.push(`No stored credential for ${data.providerId}`);
  } else {
    lines.push(`Cleared the credential for ${data.providerId} from ${labelList(data.cleared)}`);
  }
  if (data.retained.length > 0) {
    lines.push(
      `Partial: ${labelList(data.retained)} still holds the credential.`
      + ' Unlock the login keychain and run this command again.',
    );
  }
  return lines.join('\n');
};
