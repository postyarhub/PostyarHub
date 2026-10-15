import { describe, expect, it } from 'vitest';
import { safeInternalErrorFields, sanitizeDiagnosticText } from './diagnostic-scrub.js';

describe('safe internal error diagnostics', () => {
  it('redacts URL credentials, authorization headers and secret-like key/value pairs', () => {
    const result = sanitizeDiagnosticText(
      'failed https://api-user:urlSecret@example.test/path Authorization: Bearer headerSecret password=messageSecret access_token=querySecret api_key=keySecret',
    );
    expect(result).toContain('https://[REDACTED]@example.test/path');
    expect(result).toContain('Authorization: [REDACTED]');
    expect(result).not.toContain('urlSecret');
    expect(result).not.toContain('headerSecret');
    expect(result).not.toContain('messageSecret');
    expect(result).not.toContain('querySecret');
    expect(result).not.toContain('keySecret');
  });

  it('never returns the raw stack, even when the stack contains secrets', () => {
    const error = new Error('request failed password=messageSecret');
    error.stack = 'Error: https://user:stackUrlSecret@example.test/?refresh_token=stackTokenSecret password=stackPasswordSecret';
    const fields = safeInternalErrorFields(error);
    const serialized = JSON.stringify(fields);
    expect(fields.stackPresent).toBe(true);
    expect(fields.errorMessage).toContain('password=[REDACTED]');
    expect(serialized).not.toContain('stackUrlSecret');
    expect(serialized).not.toContain('stackTokenSecret');
    expect(serialized).not.toContain('stackPasswordSecret');
    expect(serialized).not.toContain('messageSecret');
  });

  it('bounds diagnostic text to a safe maximum length', () => {
    expect(sanitizeDiagnosticText('x'.repeat(5000), 200)).toHaveLength(200);
    expect(sanitizeDiagnosticText('x'.repeat(5000), 5000)).toHaveLength(1200);
  });
});
