/**
 * Fingerprint Telemetry Schema — defines the shape of cache health signals.
 *
 * No collection is implemented here. This file establishes the data contract
 * that future opt-in telemetry must conform to.
 *
 * Schema design goals:
 * - Avoid "garbage in": measure signals we know how to act on.
 * - Avoid "privacy nightmare": explicitly declare what is NOT collected.
 * - Enable future opt-in collection without backward-incompatible storage changes.
 *
 * Future opt-in telemetry (deferred):
 * - Collection must be explicit user opt-in (DEEPSEEK_CACHE_TELEMETRY=1).
 * - Submission goes to a community-operated endpoint (separate concern).
 * - Payloads are anonymous (stable userId hash, no PII).
 */

/**
 * Prefix stability signal — how stable is the normalized system prompt over time?
 *
 * Computed as a sliding window probability distribution over recent turns.
 * Useful for detecting "normalization is working" vs "every turn changes the prefix".
 */
export interface PrefixStabilitySignal {
  /** ISO timestamp of observation window end */
  observedAt: string
  /** Fingerprint of normalized system prompt at window end */
  fingerprint: string
  /** Number of turns in the window */
  windowTurns: number
  /** Number of distinct fingerprints in the window (1 = fully stable) */
  distinctFingerprints: number
  /** Stability ratio: 1 - (distinct - 1) / max(windowTurns - 1, 1), range [0, 1] */
  stability: number
}

/**
 * Normalization effectiveness signal — is the regex engine actually replacing content?
 *
 * Computed per-turn. Useful for correlating replacement counts with cache hit rates.
 */
export interface NormalizationEffectivenessSignal {
  /** ISO timestamp of the turn */
  timestamp: string
  /** Number of dynamic content replacements performed */
  replacementCount: number
  /** Whether any replacements were made (shortcut for replacementCount > 0) */
  hadReplacements: boolean
  /** Whether the normalized prompt differed from the raw input */
  normalizationChanged: boolean
  /** Which pattern categories were matched (e.g., ["timestamp", "uuid"]) */
  matchedPatternCategories: string[]
}

/**
 * Cross-session prefix reuse signal — do sessions share the same prefix?
 *
 * Computed across sessions within a time window. Useful for measuring whether
 * stable user_id is actually enabling cross-session cache pooling.
 */
export interface PrefixReuseSignal {
  /** ISO timestamp of observation window end */
  observedAt: string
  /** Time window label (e.g., "24h", "7d") */
  window: string
  /** Number of sessions observed in the window */
  sessionCount: number
  /** Number of distinct fingerprints across all sessions */
  distinctFingerprints: number
  /** Most common fingerprint in the window (mode), or null if no sessions */
  dominantFingerprint: string | null
  /** Fraction of sessions using the dominant fingerprint, range [0, 1] */
  dominantFraction: number
}

/**
 * Aggregate telemetry payload. Opt-in only.
 *
 * NOT IMPLEMENTED. This is the shape future collection must produce.
 * Any future implementation must set schemaVersion to TELEMETRY_SCHEMA_VERSION.
 */
export interface FingerprintTelemetryPayload {
  /** Schema version for forward compatibility */
  schemaVersion: 1
  /** Stable anonymous user identifier (same hash as user_id suffix) */
  anonymousId: string
  /** ISO timestamp of payload submission */
  submittedAt: string
  /** Recent prefix stability observations (sliding window) */
  prefixStability: PrefixStabilitySignal[]
  /** Recent normalization effectiveness samples (sampled per turn) */
  normalizationEffectiveness: NormalizationEffectivenessSignal[]
  /** Cross-session prefix reuse snapshots (one per window) */
  prefixReuse: PrefixReuseSignal[]
}

/**
 * Explicit non-collected fields. Documented so future implementations know what
 * must NEVER appear in a telemetry payload without explicit user opt-in.
 *
 * This list is part of the schema contract — any future collector must filter
 * these fields out of every submitted payload.
 */
export const NOT_COLLECTED = [
  'prompt content (raw or normalized)',
  'user identifiers (name, email, IP)',
  'session content or messages',
  'code or file paths',
  'model outputs or completions',
  'tool call arguments or results',
  'API keys or credentials',
] as const

/** Current schema version for payloads. */
export const TELEMETRY_SCHEMA_VERSION = 1 as const
