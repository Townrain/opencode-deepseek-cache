/**
 * Type guard utilities for parsing numeric values from JSONL records.
 * Extracted from cache-stats.ts to eliminate 4x duplication.
 */

/**
 * Parse a value as a non-negative number.
 * Returns 0 for undefined, NaN, Infinity, or negative values.
 */
export function parseNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

/**
 * Parse a value as an optional number.
 * Returns undefined for non-numeric or non-finite values.
 */
export function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Check if a value is a valid token value (non-negative finite number).
 */
export function isValidTokenValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Sanitize session ID to prevent injection attacks.
 * Removes path traversal, null bytes, control chars.
 * Limits length to 128 chars.
 */
export function sanitizeSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 128)
}

/**
 * Sanitize log message to prevent log injection.
 * Replaces newlines and control chars with spaces.
 * Limits length to 1000 chars.
 */
export function sanitizeLogMessage(msg: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional — sanitizing control chars for log injection prevention
  return msg.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 1000)
}
