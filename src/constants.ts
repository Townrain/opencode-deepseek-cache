/** Dynamic content replacement patterns — enhanced from Reasonix ImmutablePrefix */
export const DYNAMIC_PATTERNS: [RegExp, string][] = [
  // ISO timestamps with timezone (UTC Z and offsets +08:00, +05:30, etc.)
  [
    /(?<=^|\s)(?<![a-zA-Z"'])\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?(?!["'])/g,
    '[TIME]',
  ],
  // UUIDs
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[ID]'],
  // Date strings (Mon Jan 01 2025, January 01, 2025, etc.)
  [
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{4}/g,
    '[DATE]',
  ],
  [
    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/g,
    '[DATE]',
  ],
  // Version strings (v1.2.3, v1.2.3-beta.1)
  [/v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/g, '[VERSION]'],
  // Temp directory paths
  [/\/(?:tmp|temp)\/[a-zA-Z0-9_./-]+/g, '[TEMP]'],
  // Windows temp paths
  [/[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\[a-zA-Z0-9_.\\-]+/g, '[TEMP]'],
  // Process IDs in paths
  [/\/proc\/\d+/g, '[PID]'],
]

/** Get a copy of dynamic replacement patterns (safe for mutation) */
export function getDynamicPatterns(): [RegExp, string][] {
  return [...DYNAMIC_PATTERNS]
}

/** Add a dynamic replacement pattern */
export function addDynamicPattern(pattern: [RegExp, string]): void {
  DYNAMIC_PATTERNS.push(pattern)
}

/** DeepSeek model-specific pricing (CNY per 1M tokens) */
export const DEEPSEEK_PRICING_MAP = {
  // deepseek-v4-flash / deepseek-chat
  flash: { cacheMiss: 1.0, cacheHit: 0.02 } as const,
  // deepseek-v4-pro
  pro: { cacheMiss: 3.0, cacheHit: 0.025 } as const,
} as const

/** Legacy alias — defaults to flash pricing. Use getPricingForModel() instead. */
export const DEEPSEEK_PRICES = DEEPSEEK_PRICING_MAP.flash

/** Regex patterns for matching model IDs to pricing tiers */
const PRO_PATTERN = /v4-pro|deepseek-v4-pro/i

/** Get pricing for a given model ID. Defaults to flash pricing. */
export function getPricingForModel(modelId?: string): { cacheMiss: number; cacheHit: number } {
  if (!modelId) return DEEPSEEK_PRICING_MAP.flash
  if (PRO_PATTERN.test(modelId)) return DEEPSEEK_PRICING_MAP.pro
  return DEEPSEEK_PRICING_MAP.flash
}
/** Fingerprint cache settings */
export const FINGERPRINT_LENGTH = 16

/** Check if an API endpoint URL belongs to the official DeepSeek API. */
export function isOfficialDeepSeekEndpoint(apiUrl: string): boolean {
  try {
    const hostname = new URL(apiUrl).hostname
    return (
      hostname === 'api.deepseek.com' ||
      hostname.endsWith('.deepseek.com') ||
      hostname.endsWith('.deepseek.com.cn')
    )
  } catch {
    return false
  }
}

/** Max JSONL file size before rotation (env: DEEPSEEK_CACHE_MAX_JSONL_SIZE, default 10MB) */
const rawJsonlSize = Number(process.env.DEEPSEEK_CACHE_MAX_JSONL_SIZE)
export const MAX_JSONL_SIZE = Number.isFinite(rawJsonlSize) ? rawJsonlSize : 10 * 1024 * 1024

/** Max debug log file size before rotation (env: DEEPSEEK_CACHE_MAX_LOG_SIZE, default 10MB) */
const rawLogSize = Number(process.env.DEEPSEEK_CACHE_MAX_LOG_SIZE)
export const MAX_LOG_SIZE = Number.isFinite(rawLogSize) ? rawLogSize : 10 * 1024 * 1024

/** Max session baselines kept in memory (env: DEEPSEEK_CACHE_MAX_SESSIONS, default 1000) */
const rawMaxSessions = Number(process.env.DEEPSEEK_CACHE_MAX_SESSIONS)
export const MAX_SESSION_BASELINES = Number.isFinite(rawMaxSessions) ? rawMaxSessions : 1000

/** Session baseline TTL in ms (env: DEEPSEEK_CACHE_SESSION_TTL_MS, default 24h) */
const rawTtl = Number(process.env.DEEPSEEK_CACHE_SESSION_TTL_MS)
export const SESSION_BASELINE_TTL_MS = Number.isFinite(rawTtl) ? rawTtl : 86400000
