import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@core/domain/index.js';

import {
  EXIT_CODE_BY_ERROR_CODE,
  HTTP_STATUS_BY_ERROR_CODE,
  LEGACY_ERROR_CODE_BY_ERROR_CODE,
} from './http-status.js';

describe('error taxonomy mappings', () => {
  it('maps every ErrorCode to an HTTP status', () => {
    for (const code of ERROR_CODES) {
      expect(typeof HTTP_STATUS_BY_ERROR_CODE[code]).toBe('number');
    }
  });

  it('maps every ErrorCode to a CLI exit code', () => {
    for (const code of ERROR_CODES) {
      expect(typeof EXIT_CODE_BY_ERROR_CODE[code]).toBe('number');
    }
  });

  it('maps every ErrorCode to a legacy CLI string', () => {
    for (const code of ERROR_CODES) {
      expect(typeof LEGACY_ERROR_CODE_BY_ERROR_CODE[code]).toBe('string');
    }
  });

  it('has no mapping keys beyond the closed ErrorCode union', () => {
    expect(Object.keys(HTTP_STATUS_BY_ERROR_CODE).sort()).toEqual([...ERROR_CODES].sort());
    expect(Object.keys(EXIT_CODE_BY_ERROR_CODE).sort()).toEqual([...ERROR_CODES].sort());
    expect(Object.keys(LEGACY_ERROR_CODE_BY_ERROR_CODE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('assigns distinct nonzero exit codes so callers can discriminate failures', () => {
    const codes = Object.values(EXIT_CODE_BY_ERROR_CODE);
    expect(codes.every((code) => code > 0)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('maps variant_not_found to HTTP 404 and its dedicated CLI exit code', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE.variant_not_found).toBe(404);
    expect(EXIT_CODE_BY_ERROR_CODE.variant_not_found).toBe(45);
    expect(LEGACY_ERROR_CODE_BY_ERROR_CODE.variant_not_found).toBe('VARIANT_NOT_FOUND');
  });

  it('maps target_read_only to HTTP 409 and its dedicated CLI exit code', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE.target_read_only).toBe(409);
    expect(EXIT_CODE_BY_ERROR_CODE.target_read_only).toBe(46);
    expect(LEGACY_ERROR_CODE_BY_ERROR_CODE.target_read_only).toBe('TARGET_READ_ONLY');
  });

  it('maps backup failures to the specified distinct exit codes', () => {
    expect([
      EXIT_CODE_BY_ERROR_CODE.backup_disabled,
      EXIT_CODE_BY_ERROR_CODE.backup_auth_required,
      EXIT_CODE_BY_ERROR_CODE.backup_destination_error,
      EXIT_CODE_BY_ERROR_CODE.backup_quota_exceeded,
      EXIT_CODE_BY_ERROR_CODE.backup_encryption_failed,
      EXIT_CODE_BY_ERROR_CODE.backup_integrity_failed,
      EXIT_CODE_BY_ERROR_CODE.restore_refused,
      EXIT_CODE_BY_ERROR_CODE.recovery_key_required,
    ]).toEqual([47, 48, 49, 50, 51, 52, 53, 54]);
    expect(HTTP_STATUS_BY_ERROR_CODE.backup_quota_exceeded).toBe(507);
  });
});
