import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  fstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';

import {
  BACKUP_ENCRYPTION_KEY_ACCOUNT,
  appError,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import type { SecretsStore } from '@core/server/index.js';

export const ENVELOPE_FRAME_SIZE = 8 * 1024 * 1024;
export const ENVELOPE_HEADER_SIZE = 40;

const MAGIC = Buffer.from('AVCBAK1', 'ascii');
const FORMAT_VERSION = 2;
const LEGACY_FORMAT_VERSION = 1;
const LEGACY_HEADER_SIZE = 24;
const SALT_SIZE = 16;
const SUBKEY_INFO = Buffer.from('AVCBAK2', 'ascii');
const AUTH_TAG_SIZE = 16;
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const createBackupEncryptionKey = async (
  secrets: SecretsStore,
): Promise<Result<{ recoveryKey: string }, AppError>> => {
  const key = randomBytes(32);
  const stored = await secrets.set(BACKUP_ENCRYPTION_KEY_ACCOUNT, key.toString('base64'));
  if (!stored.ok) return stored;
  return ok({ recoveryKey: renderRecoveryKey(key) });
};

export const loadBackupEncryptionKey = async (
  secrets: SecretsStore,
): Promise<Result<Buffer, AppError>> => {
  const stored = await secrets.get(BACKUP_ENCRYPTION_KEY_ACCOUNT);
  if (!stored.ok) return stored;
  if (stored.value === null) {
    return { ok: false, error: appError('recovery_key_required', 'A backup recovery key is required') };
  }
  const key = Buffer.from(stored.value, 'base64');
  if (key.length !== 32) {
    return { ok: false, error: appError('recovery_key_required', 'The stored backup encryption key is invalid') };
  }
  return ok(key);
};

export const ensureBackupRecoveryKey = async (
  secrets: SecretsStore,
  locale: 'en' | 'pl' = 'en',
): Promise<Result<{ fingerprint: string; document: string }, AppError>> => {
  const stored = await secrets.get(BACKUP_ENCRYPTION_KEY_ACCOUNT);
  if (!stored.ok) return stored;
  const key = stored.value === null ? randomBytes(32) : Buffer.from(stored.value, 'base64');
  if (key.length !== 32) {
    return { ok: false, error: appError('recovery_key_required', 'The stored backup encryption key is invalid') };
  }
  if (stored.value === null) {
    const written = await secrets.set(BACKUP_ENCRYPTION_KEY_ACCOUNT, key.toString('base64'));
    if (!written.ok) return written;
  }
  return ok({
    fingerprint: backupKeyFingerprint(key),
    document: recoveryKeyDocument(renderRecoveryKey(key), locale),
  });
};

export const backupKeyFingerprint = (key: Buffer): string =>
  `sha256:${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;

const recoveryKeyDocument = (recoveryKey: string, locale: 'en' | 'pl'): string => {
  const lines = locale === 'pl'
    ? [
        'AI Video Cataloger - klucz odzyskiwania kopii zapasowej',
        '',
        recoveryKey,
        '',
        'Ten klucz jest jedynym sposobem odczytania zaszyfrowanych kopii na innym Macu.',
        'Kazda osoba z tym kluczem moze je odczytac. Przechowuj go tam, gdzie hasla.',
        '',
      ]
    : [
        'AI Video Cataloger - backup recovery key',
        '',
        recoveryKey,
        '',
        'This key is the only way to read your encrypted backups on another Mac.',
        'Anyone holding it can read them. Store it where you store passwords.',
        '',
      ];
  return lines.join('\n');
};

export const renderRecoveryKey = (key: Buffer): string => {
  if (key.length !== 32) throw new Error('Backup encryption keys must be 32 bytes');
  const encoded = encodeCrockford(key);
  const checksum = recoveryChecksum(key);
  return [
    encoded.slice(0, 10),
    encoded.slice(10, 20),
    encoded.slice(20, 30),
    encoded.slice(30, 40),
    encoded.slice(40),
    checksum,
  ].join('-');
};

export const parseRecoveryKey = (value: string): Result<Buffer, AppError> => {
  const normalized = value.toUpperCase().replaceAll('-', '').replaceAll('O', '0').replaceAll('I', '1').replaceAll('L', '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{56}$/.test(normalized)) return invalidRecoveryKey();
  const encoded = normalized.slice(0, 52);
  const checksum = normalized.slice(52);
  const decoded = decodeCrockford(encoded);
  if (decoded === null || decoded.length !== 32 || recoveryChecksum(decoded) !== checksum) return invalidRecoveryKey();
  return ok(decoded);
};

export const encryptBackupEnvelope = async (
  sourcePath: string,
  destinationPath: string,
  key: Buffer,
  signal?: AbortSignal | undefined,
): Promise<Result<{ frameCount: number; sizeBytes: number }, AppError>> => {
  if (key.length !== 32) return encryptionFailure('Backup encryption key must be 32 bytes');
  const tempPath = `${destinationPath}.tmp`;
  let source = -1;
  let output = -1;
  try {
    source = openSync(sourcePath, 'r');
    output = openSync(tempPath, 'w', 0o600);
    const sourceSize = fstatSync(source).size;
    const frameCount = Math.max(1, Math.ceil(sourceSize / ENVELOPE_FRAME_SIZE));
    const noncePrefix = randomBytes(4);
    const salt = randomBytes(SALT_SIZE);
    const frameKey = deriveFrameKey(key, salt);
    writeSync(output, createHeader(noncePrefix, salt, 0));
    let sourceOffset = 0;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfAborted(signal);
      const isLastFrame = frameIndex === frameCount - 1;
      const plainSize = isLastFrame ? sourceSize - sourceOffset : ENVELOPE_FRAME_SIZE;
      const plain = Buffer.alloc(plainSize);
      if (plainSize > 0) readExactly(source, plain, sourceOffset);
      sourceOffset += plainSize;
      const cipher = createCipheriv('aes-256-gcm', frameKey, frameNonce(noncePrefix, frameIndex));
      cipher.setAAD(frameAad(FORMAT_VERSION, frameIndex, isLastFrame));
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      writeSync(output, encrypted);
      writeSync(output, cipher.getAuthTag());
    }
    writeSync(output, frameCountBuffer(frameCount), 0, 8, 16);
    fsyncSync(output);
    closeSync(source);
    source = -1;
    closeSync(output);
    output = -1;
    renameSync(tempPath, destinationPath);
    return ok({ frameCount, sizeBytes: fstatPathSize(destinationPath) });
  } catch (cause) {
    if (source !== -1) closeSync(source);
    if (output !== -1) closeSync(output);
    removeIfPresent(tempPath);
    return encryptionFailure(errorMessage(cause));
  }
};

export const decryptBackupEnvelope = async (
  sourcePath: string,
  destinationPath: string,
  key: Buffer,
  signal?: AbortSignal | undefined,
): Promise<Result<{ frameCount: number; sizeBytes: number }, AppError>> => {
  if (key.length !== 32) return encryptionFailure('Backup encryption key must be 32 bytes');
  const tempPath = `${destinationPath}.tmp`;
  let source = -1;
  let output = -1;
  try {
    source = openSync(sourcePath, 'r');
    const sourceSize = fstatSync(source).size;
    const parsed = readHeader(source);
    const frameKey = parsed.version === LEGACY_FORMAT_VERSION ? key : deriveFrameKey(key, parsed.salt);
    const encryptedPayloadSize = sourceSize - parsed.headerSize;
    const plainSize = encryptedPayloadSize - parsed.frameCount * AUTH_TAG_SIZE;
    if (plainSize < 0 || plainSize > parsed.frameCount * ENVELOPE_FRAME_SIZE) throw new Error('Invalid envelope length');
    const lastFrameSize = plainSize - (parsed.frameCount - 1) * ENVELOPE_FRAME_SIZE;
    if (lastFrameSize < 0 || lastFrameSize > ENVELOPE_FRAME_SIZE) throw new Error('Invalid final frame length');
    if (parsed.frameCount > 1 && lastFrameSize === 0) throw new Error('Invalid empty final frame');
    output = openSync(tempPath, 'w', 0o600);
    let sourceOffset = parsed.headerSize;
    let written = 0;
    for (let frameIndex = 0; frameIndex < parsed.frameCount; frameIndex += 1) {
      throwIfAborted(signal);
      const isLastFrame = frameIndex === parsed.frameCount - 1;
      const cipherSize = isLastFrame ? lastFrameSize : ENVELOPE_FRAME_SIZE;
      const encrypted = Buffer.alloc(cipherSize);
      const tag = Buffer.alloc(AUTH_TAG_SIZE);
      if (cipherSize > 0) readExactly(source, encrypted, sourceOffset);
      sourceOffset += cipherSize;
      readExactly(source, tag, sourceOffset);
      sourceOffset += AUTH_TAG_SIZE;
      const decipher = createDecipheriv('aes-256-gcm', frameKey, frameNonce(parsed.noncePrefix, frameIndex));
      decipher.setAAD(frameAad(parsed.version, frameIndex, isLastFrame));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      writeSync(output, plain);
      written += plain.length;
    }
    if (sourceOffset !== sourceSize || written !== plainSize) throw new Error('Envelope frame count does not match its length');
    fsyncSync(output);
    closeSync(source);
    source = -1;
    closeSync(output);
    output = -1;
    renameSync(tempPath, destinationPath);
    return ok({ frameCount: parsed.frameCount, sizeBytes: written });
  } catch (cause) {
    if (source !== -1) closeSync(source);
    if (output !== -1) closeSync(output);
    removeIfPresent(tempPath);
    removeIfPresent(destinationPath);
    return encryptionFailure(errorMessage(cause));
  }
};

const createHeader = (noncePrefix: Buffer, salt: Buffer, frameCount: number): Buffer => {
  const header = Buffer.alloc(ENVELOPE_HEADER_SIZE);
  MAGIC.copy(header, 0);
  header[7] = FORMAT_VERSION;
  noncePrefix.copy(header, 8);
  header.writeUInt32BE(ENVELOPE_FRAME_SIZE, 12);
  frameCountBuffer(frameCount).copy(header, 16);
  salt.copy(header, 24);
  return header;
};

interface EnvelopeHeader {
  version: number;
  headerSize: number;
  noncePrefix: Buffer;
  salt: Buffer;
  frameCount: number;
}

const readHeader = (descriptor: number): EnvelopeHeader => {
  const prelude = Buffer.alloc(MAGIC.length + 1);
  readExactly(descriptor, prelude, 0);
  if (!prelude.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid backup envelope magic');
  const version = prelude[MAGIC.length] ?? 0;
  if (version !== FORMAT_VERSION && version !== LEGACY_FORMAT_VERSION) throw new Error('Unsupported backup envelope version');
  const headerSize = version === LEGACY_FORMAT_VERSION ? LEGACY_HEADER_SIZE : ENVELOPE_HEADER_SIZE;
  const header = Buffer.alloc(headerSize);
  readExactly(descriptor, header, 0);
  if (header.readUInt32BE(12) !== ENVELOPE_FRAME_SIZE) throw new Error('Unsupported backup envelope frame size');
  const count = header.readBigUInt64BE(16);
  if (count < 1n || count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid backup envelope frame count');
  return {
    version,
    headerSize,
    noncePrefix: Buffer.from(header.subarray(8, 12)),
    salt: Buffer.from(header.subarray(24, 24 + SALT_SIZE)),
    frameCount: Number(count),
  };
};

const deriveFrameKey = (key: Buffer, salt: Buffer): Buffer =>
  Buffer.from(hkdfSync('sha256', key, salt, SUBKEY_INFO, 32));

const frameNonce = (prefix: Buffer, frameIndex: number): Buffer => {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeBigUInt64BE(BigInt(frameIndex), 4);
  return nonce;
};

const frameAad = (version: number, frameIndex: number, isLastFrame: boolean): Buffer => {
  const aad = Buffer.alloc(MAGIC.length + 1 + 8 + 1);
  MAGIC.copy(aad, 0);
  aad[MAGIC.length] = version;
  aad.writeBigUInt64BE(BigInt(frameIndex), MAGIC.length + 1);
  aad[aad.length - 1] = isLastFrame ? 1 : 0;
  return aad;
};

const frameCountBuffer = (frameCount: number): Buffer => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(frameCount));
  return bytes;
};

const encodeCrockford = (bytes: Buffer): string => {
  let bits = 0;
  let bitCount = 0;
  let output = '';
  for (const byte of bytes) {
    bits = bits * 256 + byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      const divisor = 2 ** bitCount;
      const index = Math.floor(bits / divisor);
      output += CROCKFORD_ALPHABET[index] ?? '';
      bits %= divisor;
    }
  }
  if (bitCount > 0) output += CROCKFORD_ALPHABET[bits * 2 ** (5 - bitCount)] ?? '';
  return output;
};

const decodeCrockford = (encoded: string): Buffer | null => {
  const output: number[] = [];
  let bits = 0;
  let bitCount = 0;
  for (const character of encoded) {
    const value = CROCKFORD_ALPHABET.indexOf(character);
    if (value === -1) return null;
    bits = bits * 32 + value;
    bitCount += 5;
    while (bitCount >= 8) {
      bitCount -= 8;
      const divisor = 2 ** bitCount;
      output.push(Math.floor(bits / divisor));
      bits %= divisor;
    }
  }
  if (bits !== 0) return null;
  return Buffer.from(output);
};

const recoveryChecksum = (key: Buffer): string => encodeCrockford(createHash('sha256').update(key).digest()).slice(0, 4);
const invalidRecoveryKey = (): Result<never, AppError> => ({
  ok: false,
  error: appError('recovery_key_required', 'The backup recovery key is invalid'),
});
const encryptionFailure = (message: string): Result<never, AppError> => ({
  ok: false,
  error: appError('backup_encryption_failed', `Backup encryption failed: ${message}`),
});
const readExactly = (descriptor: number, target: Buffer, position: number): void => {
  if (readSync(descriptor, target, 0, target.length, position) !== target.length) throw new Error('Backup envelope is truncated');
};
const fstatPathSize = (filePath: string): number => {
  const descriptor = openSync(filePath, 'r');
  try {
    return fstatSync(descriptor).size;
  } finally {
    closeSync(descriptor);
  }
};
const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
};
const removeIfPresent = (filePath: string): void => {
  if (existsSync(filePath)) unlinkSync(filePath);
};
const errorMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
