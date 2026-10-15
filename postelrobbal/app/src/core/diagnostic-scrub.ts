/** Redacts common credential forms before diagnostic text is persisted. */
export function sanitizeDiagnosticText(value: unknown, maxLength = 1200): string {
  const limit = Number.isSafeInteger(maxLength) && maxLength > 0 ? Math.min(maxLength, 1200) : 1200;
  return String(value ?? '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@')
    .replace(/(\bauthorization\b\s*[:=]\s*)(?:bearer\s+)?[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:password|passphrase|access[_-]?token|refresh[_-]?token|token|secret|api[_-]?key|client[_-]?secret|access[_-]?key)\b\s*[:=]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .slice(0, limit);
}

/** Only safe, bounded fields are allowed into the internal error record. */
export function safeInternalErrorFields(error: Error): {
  errorName: string;
  errorMessage: string;
  stackPresent: boolean;
} {
  return {
    errorName: sanitizeDiagnosticText(error.name, 120),
    errorMessage: sanitizeDiagnosticText(error.message, 1200),
    // Do not persist the stack itself: libraries and URL-bearing errors can put
    // credentials into stack lines even when error.message was scrubbed.
    stackPresent: Boolean(error.stack),
  };
}
