/** Dynamic content replacement patterns — enhanced from Reasonix ImmutablePrefix */
export const DYNAMIC_PATTERNS: [RegExp, string][] = [
  // ISO timestamps with timezone (UTC Z and offsets +08:00, +05:30, etc.)
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '[TIME]'],
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
  [/\/(?:tmp|temp)\/[a-zA-Z0-9_-]+/g, '[TEMP]'],
  // Windows temp paths
  [/[A-Z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\[a-zA-Z0-9_-]+/g, '[TEMP]'],
  // Process IDs in paths
  [/\/proc\/\d+/g, '[PID]'],
]

/** DeepSeek prices (CNY per 1M tokens) */
export const DEEPSEEK_PRICES = {
  cacheMiss: 3.0, // 3元/百万tokens (缓存未命中)
  cacheHit: 0.025, // 0.025元/百万tokens (缓存命中)
} as const
/** Fingerprint cache settings */
export const FINGERPRINT_LENGTH = 16

/** Check if an API endpoint URL belongs to the official DeepSeek API. */
export function isOfficialDeepSeekEndpoint(apiUrl: string): boolean {
  try {
    const hostname = new URL(apiUrl).hostname
    return hostname === 'api.deepseek.com'
      || hostname.endsWith('.deepseek.com')
      || hostname.endsWith('.deepseek.com.cn')
  } catch {
    return false
  }
}
