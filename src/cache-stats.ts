import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getPricingWithOverrides, MAX_JSONL_SIZE, SESSION_BASELINE_TTL_MS } from './constants.js'
import { rotateFileIfNeeded } from './file-utils.js'
import { loadAllFromJsonl as _loadAllFromJsonl, forEachJsonlRecord } from './jsonl/reader.js'
import { log } from './logger.js'
import type { BaselineRecord, CacheStats, UsageRecord } from './types.js'

/** Module-level flag: set when appendUsageToJsonl or saveBaselineToJsonl catches a write error. */
let lastCacheWriteFailed = false

/** Check and reset the last-write-failed flag. Used by PersistenceManager WAL. */
export function getLastCacheWriteFailedAndReset(): boolean {
  const result = lastCacheWriteFailed
  lastCacheWriteFailed = false
  return result
}

/** Re-export loadAllFromJsonl for backward compatibility */
export const loadAllFromJsonl = _loadAllFromJsonl
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

// Types imported from types.ts (single source of truth)

// forEachJsonlRecord imported from jsonl/reader.js (single source of truth)
export { forEachJsonlRecord } from './jsonl/reader.js'
/**
 * Load historical stats from JSONL file
 */
export function loadStatsFromJsonl(jsonlPath: string): CacheStats {
  const stats = createCacheStats()
  let lastFingerprint: string | null = null

  forEachJsonlRecord(jsonlPath, (record) => {
    const r = record as unknown as UsageRecord
    const hit = typeof r.hit === 'number' && Number.isFinite(r.hit) ? Math.max(0, r.hit) : 0
    const miss = typeof r.miss === 'number' && Number.isFinite(r.miss) ? Math.max(0, r.miss) : 0
    const write = typeof r.write === 'number' && Number.isFinite(r.write) ? Math.max(0, r.write) : 0
    const output =
      typeof r.output === 'number' && Number.isFinite(r.output) ? Math.max(0, r.output) : 0
    if (r.type !== 'fingerprint' && r.type !== 'baseline') {
      stats.totalHitTokens += hit
      stats.totalMissTokens += miss
      stats.totalWriteTokens += write
      stats.totalOutputTokens += output
      stats.requestCount++
    }

    if (r.fp && lastFingerprint && r.fp !== lastFingerprint) {
      stats.prefixChanges++
    }
    if (r.fp) lastFingerprint = r.fp
    // Restore prefixChanges from persisted pc field if available
    if (r.type === 'fingerprint' && typeof r.pc === 'number') {
      stats.prefixChanges = Math.max(stats.prefixChanges, r.pc) // Use max to preserve comparison-based count under corruption
    }

    // Update timestamps - skip corrupted timestamps (t === 0) to avoid incorrect duration
    const t = typeof r.t === 'number' && Number.isFinite(r.t) && r.t > 0 ? r.t : 0
    if (t > 0) {
      if (stats.firstRequestTime === null) stats.firstRequestTime = t
      stats.lastRequestTime = t
    }
  })

  return stats
}

/**
 * Read the last known fingerprint and model ID from JSONL history.
 * Returns { fingerprint: null, model: null } if no matching records found.
 */
export function getLastFingerprintFromJsonl(jsonlPath: string): {
  fingerprint: string | null
  model: string | null
} {
  let lastFp: string | null = null
  let lastModel: string | null = null

  forEachJsonlRecord(jsonlPath, (record) => {
    const r = record as unknown as UsageRecord
    if (r.fp) lastFp = r.fp
    if (r.model) lastModel = r.model
  })

  return { fingerprint: lastFp, model: lastModel }
}

/**
 * Append a usage record to JSONL file
 */
export function appendUsageToJsonl(
  jsonlPath: string,
  hitTokens: number,
  missTokens: number,
  writeTokens?: number,
  outputTokens?: number,
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

    // Rotate if file exceeds size limit BEFORE appending (prevents writing to wrong file)
    checkJsonlRotation(jsonlPath)

    // NOTE: A record with hitTokens=0 && missTokens=0 && fingerprint is a fingerprint-only record
    // (emitted on prefix drift). This is correct — actual usage records always have hit or miss > 0.
    const isFingerprint = hitTokens === 0 && missTokens === 0 && fingerprint !== undefined
    const record: UsageRecord = {
      t: Date.now(),
      hit: hitTokens,
      miss: missTokens,
      ...(writeTokens !== undefined ? { write: writeTokens } : {}),
      ...(outputTokens !== undefined ? { output: outputTokens } : {}),
      ...(isFingerprint ? { type: 'fingerprint' as const } : {}),
      ...(isFingerprint && typeof prefixChanges === 'number' ? { pc: prefixChanges } : {}),
      ...(fingerprint ? { fp: fingerprint } : {}),
      ...(model ? { model } : {}),
    }

    appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, 'utf-8')
  } catch (err) {
    log('ERROR: Stats write error', { error: (err as Error).message })
    lastCacheWriteFailed = true
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
  cacheWrite: number,
  output: number,
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
      cacheWrite,
      output,
      ...(fingerprint ? { fp: fingerprint } : {}),
    }

    checkJsonlRotation(jsonlPath)
    appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, 'utf-8')
  } catch (err) {
    log('ERROR: Baseline write error', { error: (err as Error).message })
    lastCacheWriteFailed = true
  }
}

/**
 * Load session baselines from JSONL. Returns the LATEST baseline per sessionID.
 */
export function loadBaselinesFromJsonl(
  jsonlPath: string,
): Map<
  string,
  { input: number; cacheRead: number; cacheWrite: number; output: number; lastAccess: number }
> {
  const baselines = new Map<
    string,
    { input: number; cacheRead: number; cacheWrite: number; output: number; lastAccess: number }
  >()

  forEachJsonlRecord(jsonlPath, (record) => {
    if (record.type === 'baseline' && typeof record.sessionID === 'string' && record.sessionID) {
      // Use 0 for NaN/Infinity timestamps so TTL filter catches them
      // (Date.now() would make corrupted baselines look fresh)
      const lastAccess = typeof record.t === 'number' && Number.isFinite(record.t) ? record.t : 0

      // Skip stale baselines that are older than TTL
      if (Date.now() - lastAccess > SESSION_BASELINE_TTL_MS) {
        return
      }

      baselines.set(record.sessionID, {
        input: typeof record.input === 'number' && Number.isFinite(record.input) ? record.input : 0,
        cacheRead:
          typeof record.cacheRead === 'number' && Number.isFinite(record.cacheRead)
            ? record.cacheRead
            : 0,
        cacheWrite:
          typeof record.cacheWrite === 'number' && Number.isFinite(record.cacheWrite)
            ? record.cacheWrite
            : 0,
        output:
          typeof record.output === 'number' && Number.isFinite(record.output) ? record.output : 0,
        lastAccess,
      })
    }
  })

  return baselines
}

export function createCacheStats(): CacheStats {
  return {
    totalHitTokens: 0,
    totalMissTokens: 0,
    totalWriteTokens: 0,
    totalOutputTokens: 0,
    requestCount: 0,
    prefixChanges: 0,
    firstRequestTime: null,
    lastRequestTime: null,
    previousHitRate: null,
    systemTransformCallCount: 0,
    lastSystemTransformTime: null,
  }
}

export function getCacheReport(
  stats: CacheStats,
  currentFingerprint?: string,
  modelId?: string,
): string {
  const total = stats.totalHitTokens + stats.totalMissTokens
  const hitRate = total > 0 ? ((stats.totalHitTokens / total) * 100).toFixed(1) : '0.0'
  const prices = getPricingWithOverrides(modelId)
  const actualCost =
    (stats.totalHitTokens / 1_000_000) * prices.cacheHit +
    (stats.totalMissTokens / 1_000_000) * prices.cacheMiss +
    (stats.totalWriteTokens / 1_000_000) * prices.cacheWrite +
    (stats.totalOutputTokens / 1_000_000) * prices.output
  const hypotheticalCost = (total / 1_000_000) * prices.cacheMiss
  const savedCost = Math.max(0, hypotheticalCost - actualCost)

  const statusIcon = Number(hitRate) >= 70 ? '🟢' : Number(hitRate) >= 30 ? '🟡' : '🔴'

  // Trend tracking
  const currentHitRate = Number(hitRate)
  const trend = stats.previousHitRate !== null ? currentHitRate - stats.previousHitRate : null
  const trendIcon = trend !== null ? (trend > 0 ? '↑' : trend < 0 ? '↓' : '-') : ''
  const trendText = trend !== null ? ` ${trendIcon}${Math.abs(trend).toFixed(1)}%` : ''

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

  const lines: string[] = []
  lines.push('### 📊 DeepSeek Cache Dashboard')
  lines.push('')
  lines.push(`- **缓存命中率**: ${statusIcon} **${hitRate}%**${trendText}`)
  lines.push(`- **命中 Tokens**: ${stats.totalHitTokens.toLocaleString()}`)
  if (stats.lastMessageStats) {
    lines.push(
      `- **最近一次请求**: 命中 ${stats.lastMessageStats.hitTokens.toLocaleString()} | 未命中 ${stats.lastMessageStats.missTokens.toLocaleString()} | 写入 ${stats.lastMessageStats.writeTokens.toLocaleString()} | 输出 ${stats.lastMessageStats.outputTokens.toLocaleString()}`,
    )
  }
  lines.push(`- **未命中 Tokens**: ${stats.totalMissTokens.toLocaleString()}`)
  if (stats.totalWriteTokens > 0) {
    lines.push(`- **缓存写 Tokens**: ${stats.totalWriteTokens.toLocaleString()}`)
  }
  if (stats.totalOutputTokens > 0) {
    lines.push(`- **输出 Tokens**: ${stats.totalOutputTokens.toLocaleString()}`)
  }
  lines.push(`- **累计请求数**: ${stats.requestCount}`)
  lines.push(`- **实际花费**: ¥${actualCost.toFixed(4)}`)
  lines.push(`- **无缓存花费**: ¥${hypotheticalCost.toFixed(4)}`)
  lines.push(`- **节省金额**: 💰 **¥${savedCost.toFixed(4)}**`)
  lines.push(
    `- **节省比例**: ${hypotheticalCost > 0 ? ((savedCost / hypotheticalCost) * 100).toFixed(1) : '0.0'}%`,
  )
  if (stats.prefixChanges > 0) {
    lines.push(`- **前缀变化**: ⚠️ ${stats.prefixChanges} 次`)
  }
  if (currentFingerprint) {
    lines.push(`- **当前指纹**: \`${currentFingerprint}\``)
  }
  if (durationText !== null) {
    lines.push(`- **会话时长**: ${durationText}`)
  }
  if (stats.systemTransformCallCount > 0) {
    lines.push(`- **规范化 Hook**: ✅ Active (调用 ${stats.systemTransformCallCount} 次)`)
  } else if (stats.requestCount > 3) {
    lines.push(
      '- **规范化 Hook**: ❌ **INACTIVE** — `experimental.chat.system.transform` 未被调用，系统提示词规范化未生效！缓存命中率可能下降。',
    )
  }
  lines.push('')
  lines.push(
    `> 💡 命中部分按 ¥${prices.cacheHit}/百万tokens 计费，未命中按 ¥${prices.cacheMiss}/百万tokens 计费，缓存写按 ¥${prices.cacheWrite}/百万tokens 计费，输出按 ¥${prices.output}/百万tokens 计费。保持 user_id 稳定以获得跨会话缓存收益。`,
  )
  lines.push('')
  lines.push('> ⚠️ 多模型混用时，成本为近似值（基于当前模型定价）。')
  lines.push('')
  lines.push('')
  lines.push('---')
  lines.push('*📊 DeepSeek Cache Statistics Report*')
  return lines.join('\n')
}
