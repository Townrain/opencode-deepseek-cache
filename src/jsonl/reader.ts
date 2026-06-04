/**
 * JSONL reader — iterates over JSONL files (current + rotated).
 * Handles file discovery, parsing, and error recovery.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { SESSION_BASELINE_TTL_MS } from '../constants.js'
import type { CacheStats, UsageRecord } from '../types.js'

/**
 * Iterate over all records in JSONL files (current + rotated).
 * Handles file discovery, parsing, and error recovery.
 */
export function forEachJsonlRecord(
  jsonlPath: string,
  callback: (record: Record<string, unknown>) => void,
): void {
  try {
    const dir = dirname(jsonlPath)
    if (!existsSync(dir)) return

    const base = basename(jsonlPath)
    const currentFile = join(dir, base)
    const rotatedFiles = readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.`) && f !== base)
      .sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop())) // ascending by numeric timestamp suffix
      .slice(-9) // keep 9 rotated + 1 current = 10 max
      .map((f) => join(dir, f))

    // Process rotated (oldest first), THEN current file (newest last)
    const files = [...rotatedFiles]
    if (existsSync(currentFile)) files.push(currentFile)

    for (const file of files) {
      try {
        if (!existsSync(file)) continue
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n').filter((l) => l.trim())
        for (const line of lines) {
          try {
            callback(JSON.parse(line))
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
}

/**
 * Load historical stats from JSONL file
 */
export function loadStatsFromJsonl(jsonlPath: string): CacheStats {
  const stats: CacheStats = {
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

/**
 * Load all data from JSONL in a single pass.
 * Combines stats, fingerprint, and baselines loading for startup efficiency.
 * M5 fix: Eliminates 3-4 separate file reads at startup.
 */
export function loadAllFromJsonl(jsonlPath: string): {
  stats: CacheStats
  fingerprint: string | null
  model: string | null
  baselines: Map<
    string,
    { input: number; cacheRead: number; cacheWrite: number; output: number; lastAccess: number }
  >
} {
  const stats: CacheStats = {
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
  let lastFingerprint: string | null = null
  let lastModel: string | null = null
  const baselines = new Map<
    string,
    { input: number; cacheRead: number; cacheWrite: number; output: number; lastAccess: number }
  >()

  forEachJsonlRecord(jsonlPath, (record) => {
    const r = record as unknown as UsageRecord

    // --- Stats accumulation (from loadStatsFromJsonl) ---
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
    if (r.type === 'fingerprint' && typeof r.pc === 'number') {
      stats.prefixChanges = Math.max(stats.prefixChanges, r.pc)
    }

    const t = typeof r.t === 'number' && Number.isFinite(r.t) && r.t > 0 ? r.t : 0
    if (t > 0) {
      if (stats.firstRequestTime === null) stats.firstRequestTime = t
      stats.lastRequestTime = t
    }

    // --- Fingerprint/model tracking (from getLastFingerprintFromJsonl) ---
    if (r.model) lastModel = r.model

    // --- Baseline loading (from loadBaselinesFromJsonl) ---
    if (record.type === 'baseline' && typeof record.sessionID === 'string' && record.sessionID) {
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

  return { stats, fingerprint: lastFingerprint, model: lastModel, baselines }
}
