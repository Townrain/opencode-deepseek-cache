import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { getPricingForModel } from './constants.js'
import { log } from './logger.js'
import { rotateFileIfNeeded } from './file-utils.js'

/** Max JSONL file size before rotation (10MB, same as logger) */
const MAX_JSONL_SIZE = 10 * 1024 * 1024

/** Check if JSONL file needs rotation and rename if so. Follows logger.ts pattern. */
function checkJsonlRotation(jsonlPath: string): void {
  try {
    const rotated = rotateFileIfNeeded(jsonlPath, MAX_JSONL_SIZE, 3)
    if (rotated) {
      log('JSONL rotated', { path: jsonlPath })
    }
  } catch (err) {
    log('JSONL rotation error (non-critical)', { error: String(err) })
  }
}

export interface CacheStats {
  totalHitTokens: number
  totalMissTokens: number
  requestCount: number
  /** Prefix fingerprint changes (cache misses due to prefix drift) */
  prefixChanges: number
  /** Timestamp of first request */
  firstRequestTime: number | null
  /** Timestamp of last request */
  lastRequestTime: number | null
}

// JSONL record format — enhanced with fingerprint tracking
interface UsageRecord {
  t: number // timestamp
  hit: number // cache hit tokens
  miss: number // cache miss tokens
  fp?: string // prefix fingerprint (optional, for tracking stability)
  model?: string // per-model tracking
}

/**
 * Load historical stats from JSONL file
 */
export function loadStatsFromJsonl(jsonlPath: string): CacheStats {
  const stats = createCacheStats()

  try {
    const dir = dirname(jsonlPath)
    if (!existsSync(dir)) return stats

    const base = basename(jsonlPath)
    // Collect current + all rotated files (e.g., file.jsonl, file.jsonl.1234567890)
    const files = readdirSync(dir)
      .filter((f) => f === base || f.startsWith(base + '.'))
      .sort() // chronological by name (rotated suffixes are timestamps)
      .slice(-10) // cap at most recent 10 files
      .map((f) => join(dir, f))

    let lastFingerprint: string | null = null

    for (const file of files) {
      try {
        if (!existsSync(file)) continue
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n').filter((line) => line.trim())

        for (const line of lines) {
          try {
            const record: UsageRecord = JSON.parse(line)
            stats.totalHitTokens += record.hit ?? 0
            stats.totalMissTokens += record.miss ?? 0
            stats.requestCount++

            if (record.fp && lastFingerprint && record.fp !== lastFingerprint) {
              stats.prefixChanges++
            }
            if (record.fp) lastFingerprint = record.fp

            const t = typeof record.t === 'number' ? record.t : Date.now()
            if (!stats.firstRequestTime) stats.firstRequestTime = t
            stats.lastRequestTime = t
          } catch (err) {
            log('JSONL parse error', {
              file: basename(file),
              line: line.slice(0, 100),
              error: String(err),
            })
          }
        }
      } catch (err) {
        console.error('[deepseek-cache] Rotated file read error:', (err as Error).message)
      }
    }
  } catch {
    // Directory read error, return empty stats
  }

  return stats
}

/**
 * Append a usage record to JSONL file
 */
export function appendUsageToJsonl(
  jsonlPath: string,
  hitTokens: number,
  missTokens: number,
  fingerprint?: string,
  model?: string,
): void {
  try {
    // Ensure directory exists
    const dir = dirname(jsonlPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const record: UsageRecord = {
      t: Date.now(),
      hit: hitTokens,
      miss: missTokens,
      ...(fingerprint ? { fp: fingerprint } : {}),
      ...(model ? { model } : {}),
    }

    // Rotate if file exceeds size limit before appending
    checkJsonlRotation(jsonlPath)

    const lockPath = `${jsonlPath}.lock`
    let fd: number | undefined
    try {
      // Exclusive create lock (fails if another process holds it)
      fd = openSync(lockPath, 'wx')
    } catch {
      // Lock held by another process — skip this write to avoid corruption
      return
    }
    try {
      appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, 'utf-8')
    } finally {
      if (fd !== undefined) {
        closeSync(fd)
        try {
          unlinkSync(lockPath)
        } catch {
          /* lock cleanup error — non-critical */
        }
      }
    }
  } catch (err) {
    console.error('[deepseek-cache] Stats write error:', (err as Error).message)
  }
}

export function createCacheStats(): CacheStats {
  return {
    totalHitTokens: 0,
    totalMissTokens: 0,
    requestCount: 0,
    prefixChanges: 0,
    firstRequestTime: null,
    lastRequestTime: null,
  }
}

export function getCacheReport(
  stats: CacheStats,
  currentFingerprint?: string,
  modelId?: string,
): string {
  const total = stats.totalHitTokens + stats.totalMissTokens
  const hitRate = total > 0 ? ((stats.totalHitTokens / total) * 100).toFixed(1) : '0.0'
  const prices = getPricingForModel(modelId)
  const savedCost = (stats.totalHitTokens / 1_000_000) * (prices.cacheMiss - prices.cacheHit)
  const actualCost =
    (stats.totalHitTokens / 1_000_000) * prices.cacheHit +
    (stats.totalMissTokens / 1_000_000) * prices.cacheMiss
  const hypotheticalCost = (total / 1_000_000) * prices.cacheMiss

  const statusIcon = Number(hitRate) >= 70 ? '🟢' : Number(hitRate) >= 30 ? '🟡' : '🔴'

  // Session duration
  const duration =
    stats.firstRequestTime && stats.lastRequestTime
      ? Math.round((stats.lastRequestTime - stats.firstRequestTime) / 1000 / 60)
      : null

  return `### 📊 DeepSeek Cache Dashboard

- **缓存命中率**: ${statusIcon} **${hitRate}%**
- **命中 Tokens**: ${stats.totalHitTokens.toLocaleString()}
- **未命中 Tokens**: ${stats.totalMissTokens.toLocaleString()}
- **累计请求数**: ${stats.requestCount}
- **实际花费**: ¥${actualCost.toFixed(4)}
- **无缓存花费**: ¥${hypotheticalCost.toFixed(4)}
- **节省金额**: 💰 **¥${savedCost.toFixed(4)}**
- **节省比例**: ${hypotheticalCost > 0 ? ((savedCost / hypotheticalCost) * 100).toFixed(1) : '0.0'}%
${stats.prefixChanges > 0 ? `- **前缀变化**: ⚠️ ${stats.prefixChanges} 次` : ''}
${duration !== null ? `- **会话时长**: ${duration} 分钟` : ''}
${currentFingerprint ? `- **当前指纹**: ${currentFingerprint}` : ''}
> 💡 命中部分按 ¥${prices.cacheHit}/百万tokens 计费，未命中按 ¥${prices.cacheMiss}/百万tokens 计费。保持 user_id 稳定以获得跨会话缓存收益。

---
*📊 DeepSeek Cache Statistics Report*`
}
