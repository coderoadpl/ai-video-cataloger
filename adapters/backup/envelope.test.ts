import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BACKUP_ENCRYPTION_KEY_ACCOUNT, ok, type AppError, type Result } from '@core/domain/index.js';
import type { SecretsAvailability, SecretsStore } from '@core/server/index.js';

import {
  ENVELOPE_FRAME_SIZE,
  ENVELOPE_HEADER_SIZE,
  createBackupEncryptionKey,
  decryptBackupEnvelope,
  ensureBackupRecoveryKey,
  encryptBackupEnvelope,
  parseRecoveryKey,
  renderRecoveryKey,
} from './envelope.js';

class MemorySecrets implements SecretsStore {
  readonly values = new Map<string, string>();

  availability(): Promise<SecretsAvailability> {
    return Promise.resolve('available');
  }

  get(account: string): Promise<Result<string | null, AppError>> {
    return Promise.resolve(ok(this.values.get(account) ?? null));
  }

  set(account: string, secret: string): Promise<Result<void, AppError>> {
    this.values.set(account, secret);
    return Promise.resolve(ok(undefined));
  }

  delete(account: string): Promise<Result<{ existed: boolean }, AppError>> {
    return Promise.resolve(ok({ existed: this.values.delete(account) }));
  }
}

describe('backup encryption envelope', () => {
  it('encrypts and decrypts multiple authenticated frames', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-envelope-'));
    const plain = path.join(root, 'plain.bin');
    const encrypted = path.join(root, 'archive.avcbak');
    const decrypted = path.join(root, 'decrypted.bin');
    const bytes = Buffer.alloc(ENVELOPE_FRAME_SIZE * 2 + 97);
    bytes.fill(0x61, 0, ENVELOPE_FRAME_SIZE);
    bytes.fill(0x62, ENVELOPE_FRAME_SIZE, ENVELOPE_FRAME_SIZE * 2);
    bytes.fill(0x63, ENVELOPE_FRAME_SIZE * 2);
    writeFileSync(plain, bytes);
    const key = Buffer.alloc(32, 7);

    expect(await encryptBackupEnvelope(plain, encrypted, key)).toMatchObject({ ok: true, value: { frameCount: 3 } });
    expect(await decryptBackupEnvelope(encrypted, decrypted, key)).toMatchObject({ ok: true, value: { frameCount: 3 } });
    expect(readFileSync(decrypted).equals(bytes)).toBe(true);
    expect(readFileSync(encrypted).includes(bytes.subarray(0, 64))).toBe(false);
  });

  it.each(['flipped bit', 'dropped frame', 'reordered frames', 'truncated stream', 'wrong key'])(
    'rejects a %s without publishing partial plaintext',
    async (failure) => {
      const root = mkdtempSync(path.join(tmpdir(), 'avc-envelope-invalid-'));
      const plain = path.join(root, 'plain.bin');
      const encrypted = path.join(root, 'archive.avcbak');
      const output = path.join(root, 'output.bin');
      writeFileSync(plain, Buffer.alloc(ENVELOPE_FRAME_SIZE * 2 + 31, 5));
      const key = Buffer.alloc(32, 9);
      const created = await encryptBackupEnvelope(plain, encrypted, key);
      expect(created).toMatchObject({ ok: true });
      const bytes = readFileSync(encrypted);
      const fullFrameBytes = ENVELOPE_FRAME_SIZE + 16;
      if (failure === 'flipped bit') bytes[ENVELOPE_HEADER_SIZE + 10] = (bytes[ENVELOPE_HEADER_SIZE + 10] ?? 0) ^ 1;
      if (failure === 'dropped frame') {
        writeFileSync(encrypted, Buffer.concat([
          bytes.subarray(0, ENVELOPE_HEADER_SIZE),
          bytes.subarray(ENVELOPE_HEADER_SIZE + fullFrameBytes),
        ]));
      } else if (failure === 'reordered frames') {
        writeFileSync(encrypted, Buffer.concat([
          bytes.subarray(0, ENVELOPE_HEADER_SIZE),
          bytes.subarray(ENVELOPE_HEADER_SIZE + fullFrameBytes, ENVELOPE_HEADER_SIZE + fullFrameBytes * 2),
          bytes.subarray(ENVELOPE_HEADER_SIZE, ENVELOPE_HEADER_SIZE + fullFrameBytes),
          bytes.subarray(ENVELOPE_HEADER_SIZE + fullFrameBytes * 2),
        ]));
      } else if (failure === 'truncated stream') {
        writeFileSync(encrypted, bytes.subarray(0, bytes.length - 7));
      } else if (failure === 'flipped bit') {
        writeFileSync(encrypted, bytes);
      }

      const result = await decryptBackupEnvelope(
        encrypted,
        output,
        failure === 'wrong key' ? Buffer.alloc(32, 4) : key,
      );
      expect(result).toMatchObject({ ok: false, error: { code: 'backup_encryption_failed' } });
      expect(existsSync(output)).toBe(false);
    },
  );

  it('stores a generated 256-bit key under the dedicated Keychain account', async () => {
    const secrets = new MemorySecrets();
    const created = await createBackupEncryptionKey(secrets);

    expect(created).toMatchObject({ ok: true });
    expect(Buffer.from(secrets.values.get(BACKUP_ENCRYPTION_KEY_ACCOUNT) ?? '', 'base64')).toHaveLength(32);
  });

  it('keeps generated key material out of archive metadata and event-shaped output', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-envelope-secret-'));
    const plain = path.join(root, 'archive.tar.zst');
    const encrypted = path.join(root, 'archive.avcbak');
    const secrets = new MemorySecrets();
    const created = await createBackupEncryptionKey(secrets);
    if (!created.ok) throw new Error(created.error.message);
    const stored = secrets.values.get(BACKUP_ENCRYPTION_KEY_ACCOUNT) ?? '';
    const manifest = JSON.stringify({ formatVersion: 1, tier: 'critical', files: [] });
    const event = JSON.stringify({ type: 'completed', archive: 'avc-critical-20260902T120000Z.avcbak' });
    writeFileSync(plain, manifest);

    expect(await encryptBackupEnvelope(plain, encrypted, Buffer.from(stored, 'base64'))).toMatchObject({ ok: true });
    for (const output of [manifest, event, readFileSync(encrypted).toString('utf8')]) {
      expect(output).not.toContain(stored);
      expect(output).not.toContain(created.value.recoveryKey);
    }
  });

  it('creates the recovery-key document once and reuses the stored key afterwards', async () => {
    const secrets = new MemorySecrets();

    const first = await ensureBackupRecoveryKey(secrets);
    const stored = secrets.values.get(BACKUP_ENCRYPTION_KEY_ACCOUNT) ?? '';
    const second = await ensureBackupRecoveryKey(secrets);

    expect(first).toMatchObject({ ok: true });
    expect(first).toEqual(second);
    expect(secrets.values.get(BACKUP_ENCRYPTION_KEY_ACCOUNT)).toBe(stored);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.fingerprint).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(first.value.document).toContain(renderRecoveryKey(Buffer.from(stored, 'base64')));
    expect(first.value.document).not.toContain(stored);
  });

  it('refuses to rebuild a recovery key from a corrupted Keychain entry', async () => {
    const secrets = new MemorySecrets();
    secrets.values.set(BACKUP_ENCRYPTION_KEY_ACCOUNT, 'dG9vLXNob3J0');

    expect(await ensureBackupRecoveryKey(secrets)).toMatchObject({
      ok: false,
      error: { code: 'recovery_key_required' },
    });
  });

  it('renders and parses a checksummed Crockford recovery key', () => {
    const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    const rendered = renderRecoveryKey(key);
    const parsed = parseRecoveryKey(rendered);
    const typo = `${rendered.slice(0, -1)}${rendered.endsWith('0') ? '1' : '0'}`;

    expect(rendered.replaceAll('-', '')).toMatch(/^[0-9A-HJKMNP-TV-Z]{56}$/);
    expect(parsed).toEqual(ok(key));
    expect(parseRecoveryKey(typo)).toMatchObject({ ok: false, error: { code: 'recovery_key_required' } });
  });
});
