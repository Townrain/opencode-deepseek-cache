/** Sliding window size — conservative value 12 */
export const SLIDING_WINDOW_SIZE = 12

/** Max messages for summary extraction */
export const SUMMARY_MAX_MESSAGES = 12

/** Max length for plain text in summary */
export const SUMMARY_MAX_LENGTH = 500

/** Max length for text without code blocks */
export const SUMMARY_TEXT_WITHOUT_CODE_MAX_LENGTH = 300

/** Max length per code block in summary */
export const SUMMARY_CODE_BLOCK_MAX_LENGTH = 800

/** Max number of code blocks to preserve */
export const SUMMARY_MAX_CODE_BLOCKS = 3

/** Summary markers — short fixed prefix, cache-friendly */
export const SUMMARY_HEADER = "[SUMMARY]"
export const SUMMARY_FOOTER = "[/SUMMARY]"

/** Dynamic content replacement patterns — conservative strategy (timestamps and UUIDs only) */
export const DYNAMIC_PATTERNS: [RegExp, string][] = [
  // Fix: Handle both UTC (Z) and timezone offsets (+08:00, +05:30, etc.)
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "[TIME]"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[ID]"],
]

/** DeepSeek prices (USD per 1M tokens) */
export const DEEPSEEK_PRICES = {
  cacheMiss: 0.14,
  cacheHit: 0.0028,
} as const

/** Debug environment variable name */
export const DEBUG_ENV = "DEEPSEEK_CACHE_DEBUG"
