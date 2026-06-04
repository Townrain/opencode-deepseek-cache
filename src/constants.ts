/** Dynamic content replacement patterns — enhanced from Reasonix ImmutablePrefix */
export const DYNAMIC_PATTERNS: readonly [RegExp, string][] = [
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

/** Add a dynamic replacement pattern (appends to shared array) */
export function addDynamicPattern(pattern: [RegExp, string]): void {
  // Note: This mutates the shared DYNAMIC_PATTERNS array in-place.
  // This is intentional — the patterns are used at runtime for system prompt normalization.
  // For test isolation, use getDynamicPatterns() which returns a copy.
  ;(DYNAMIC_PATTERNS as [RegExp, string][]).push(pattern)
}

/** DeepSeek model-specific pricing (CNY per 1M tokens) */
export const DEEPSEEK_PRICING_MAP = {
  // deepseek-v4-flash / deepseek-chat
  // Note: DeepSeek does NOT charge for cache writes - only cache hits, misses, and output
  flash: { cacheMiss: 1.0, cacheHit: 0.02, cacheWrite: 0, output: 2.0 } as const,
  // deepseek-v4-pro
  pro: { cacheMiss: 3.0, cacheHit: 0.025, cacheWrite: 0, output: 6.0 } as const,
} as const

/** Legacy alias — defaults to flash pricing. Use getPricingForModel() instead. */
export const DEEPSEEK_PRICES = DEEPSEEK_PRICING_MAP.flash

/** Regex patterns for matching model IDs to pricing tiers */
const PRO_PATTERN = /v4-pro|deepseek-v4-pro/i

/** Get pricing for a given model ID. Defaults to flash pricing. */
export function getPricingForModel(modelId?: string): {
  cacheMiss: number
  cacheHit: number
  cacheWrite: number
  output: number
} {
  if (!modelId) return DEEPSEEK_PRICING_MAP.flash
  if (PRO_PATTERN.test(modelId)) return DEEPSEEK_PRICING_MAP.pro
  return DEEPSEEK_PRICING_MAP.flash
}

/** Environment variable overrides for pricing (CNY per 1M tokens) */
function parseEnvNumber(key: string): number | undefined {
  const val = process.env[key]
  if (val === undefined || val === '') return undefined
  const num = Number(val)
  return Number.isFinite(num) && num >= 0 ? num : undefined
}

/** Get pricing with environment variable overrides. Falls back to model-based pricing. */
export function getPricingWithOverrides(modelId?: string): {
  cacheMiss: number
  cacheHit: number
  cacheWrite: number
  output: number
} {
  const base = getPricingForModel(modelId)
  // Read env vars dynamically (not frozen at module load) to support runtime changes
  return {
    cacheMiss: parseEnvNumber('DEEPSEEK_PRICE_CACHE_MISS') ?? base.cacheMiss,
    cacheHit: parseEnvNumber('DEEPSEEK_PRICE_CACHE_HIT') ?? base.cacheHit,
    cacheWrite: parseEnvNumber('DEEPSEEK_PRICE_CACHE_WRITE') ?? base.cacheWrite,
    output: parseEnvNumber('DEEPSEEK_PRICE_OUTPUT') ?? base.output,
  }
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
export const MAX_JSONL_SIZE = Math.max(
  1,
  Math.floor(parseEnvNumber('DEEPSEEK_CACHE_MAX_JSONL_SIZE') ?? 10 * 1024 * 1024),
)

/** Max debug log file size before rotation (env: DEEPSEEK_CACHE_MAX_LOG_SIZE, default 10MB) */
export const MAX_LOG_SIZE = Math.max(
  1,
  Math.floor(parseEnvNumber('DEEPSEEK_CACHE_MAX_LOG_SIZE') ?? 10 * 1024 * 1024),
)

/** Max session baselines kept in memory (env: DEEPSEEK_CACHE_MAX_SESSIONS, default 1000) */
export const MAX_SESSION_BASELINES = Math.max(
  1,
  Math.floor(parseEnvNumber('DEEPSEEK_CACHE_MAX_SESSIONS') ?? 1000),
)

/** Session baseline TTL in ms (env: DEEPSEEK_CACHE_SESSION_TTL_MS, default 24h) */
export const SESSION_BASELINE_TTL_MS = Math.max(
  1,
  Math.floor(parseEnvNumber('DEEPSEEK_CACHE_SESSION_TTL_MS') ?? 86400000),
)
