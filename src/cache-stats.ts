import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { getPricingForModel, MAX_JSONL_SIZE } from './constants.js'
import { rotateFileIfNeeded } from './file-utils.js'
import { log } from './logger.js'


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
  type?: 'fingerprint' | 'usage' | 'baseline' // record type
  pc?: number // prefixChanges count (on fingerprint records)
}

interface BaselineRecord {
  t: number
  type: 'baseline'
  sessionID: string
  input: number
  cacheRead: number
  fp?: string
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
            if (record.type !== 'fingerprint' && record.type !== 'baseline') { stats.requestCount++ }

            if (record.fp && lastFingerprint && record.fp !== lastFingerprint) {
              stats.prefixChanges++
            }
            if (record.fp) lastFingerprint = record.fp
            // Restore prefixChanges from persisted pc field if available
            if (record.type === 'fingerprint' && typeof record.pc === 'number') {
              stats.prefixChanges = record.pc
            }

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
 * Read the last known fingerprint and model ID from JSONL history.
 * Returns { fingerprint: null, model: null } if no matching records found.
 */
export function getLastFingerprintFromJsonl(
  jsonlPath: string,
): { fingerprint: string | null; model: string | null } {
  try {
    const dir = dirname(jsonlPath)
    if (!existsSync(dir)) return { fingerprint: null, model: null }

    const base = basename(jsonlPath)
    const files = readdirSync(dir)
      .filter((f) => f === base || f.startsWith(base + '.'))
      .sort()
      .slice(-10)
      .map((f) => join(dir, f))

    let lastFp: string | null = null
    let lastModel: string | null = null
    for (const file of files) {
      try {
        if (!existsSync(file)) continue
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n').filter((l) => l.trim())
        for (const line of lines) {
          try {
            const record: UsageRecord = JSON.parse(line)
            if (record.fp) lastFp = record.fp
            if (record.model) lastModel = record.model
          } catch {
            /* skip malformed lines */
          }
        }
      } catch {
        /* skip unreadable files */
      }
    }
    return { fingerprint: lastFp, model: lastModel }
  } catch {
    return { fingerprint: null, model: null }
  }
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
  prefixChanges?: number,
): void {
  try {
    // Ensure directory exists
    const dir = dirname(jsonlPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const isFingerprint = hitTokens === 0 && missTokens === 0
    const record: UsageRecord = {
      t: Date.now(),
      hit: hitTokens,
      miss: missTokens,
      ...(isFingerprint ? { type: 'fingerprint' as const } : {}),
      ...(isFingerprint && typeof prefixChanges === 'number' ? { pc: prefixChanges } : {}),
      ...(fingerprint ? { fp: fingerprint } : {}),
      ...(model ? { model } : {}),
    }

    // Rotate if file exceeds size limit before appending
    checkJsonlRotation(jsonlPath)

    appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, 'utf-8')
  } catch (err) {
    console.error('[deepseek-cache] Stats write error:', (err as Error).message)
  }
}

/**
 * Persist a session baseline to JSONL (prevents double-counting on reload).
 */
export function saveBaselineToJsonl(
  jsonlPath: string,
  sessionID: string,
  input: number,
  cacheRead: number,
  fingerprint?: string,
): void {
  try {
    const dir = dirname(jsonlPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const record: BaselineRecord = {
      t: Date.now(),
      type: 'baseline',
      sessionID,
      input,
      cacheRead,
      ...(fingerprint ? { fp: fingerprint } : {}),
    }

    checkJsonlRotation(jsonlPath)
    appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, 'utf-8')
  } catch (err) {
    console.error('[deepseek-cache] Baseline write error:', (err as Error).message)
  }
}

/**
 * Load session baselines from JSONL. Returns the LATEST baseline per sessionID.
 */
export function loadBaselinesFromJsonl(
  jsonlPath: string,
): Map<string, { input: number; cacheRead: number }> {
  const baselines = new Map<string, { input: number; cacheRead: number }>()

  try {
    const dir = dirname(jsonlPath)
    if (!existsSync(dir)) return baselines

    const base = basename(jsonlPath)
    const files = readdirSync(dir)
      .filter((f) => f === base || f.startsWith(base + '.'))
      .sort()
      .slice(-10)
      .map((f) => join(dir, f))

    for (const file of files) {
      try {
        if (!existsSync(file)) continue
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n').filter((l) => l.trim())
        for (const line of lines) {
          try {
            const record = JSON.parse(line)
            if (record.type === 'baseline' && record.sessionID) {
              baselines.set(record.sessionID, {
                input: record.input ?? 0,
                cacheRead: record.cacheRead ?? 0,
              })
            }
          } catch {
            /* skip malformed lines */
          }
        }
      } catch {
        /* skip unreadable files */
      }
    }
  } catch {
    /* directory read error */
  }

  return baselines
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
  const durationSecs =
    stats.firstRequestTime && stats.lastRequestTime
      ? Math.round((stats.lastRequestTime - stats.firstRequestTime) / 1000)
      : null
  const durationText =
    durationSecs !== null
      ? durationSecs < 60
        ? `${durationSecs} 秒`
        : `${Math.round(durationSecs / 60)} 分钟`
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
${durationText !== null ? `- **会话时长**: ${durationText}` : ''}
${currentFingerprint ? `- **当前指纹**: ${currentFingerprint}` : ''}
> 💡 命中部分按 ¥${prices.cacheHit}/百万tokens 计费，未命中按 ¥${prices.cacheMiss}/百万tokens 计费。保持 user_id 稳定以获得跨会话缓存收益。

> ⚠️ 多模型混用时，成本为近似值（基于当前模型定价）。

---
*📊 DeepSeek Cache Statistics Report*`
}
