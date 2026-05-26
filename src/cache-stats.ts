import { DEEPSEEK_PRICES } from "./constants.js"
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"

export interface CacheStats {
  totalHitTokens: number
  totalMissTokens: number
  requestCount: number
}

// JSONL record format
interface UsageRecord {
  t: number    // timestamp
  hit: number  // cache hit tokens
  miss: number // cache miss tokens
}

/**
 * Load historical stats from JSONL file
 */
export function loadStatsFromJsonl(jsonlPath: string): CacheStats {
  const stats = createCacheStats()
  
  try {
    if (!existsSync(jsonlPath)) return stats

    const content = readFileSync(jsonlPath, "utf-8")
    const lines = content.split("\n").filter(line => line.trim())

    for (const line of lines) {
      try {
        const record: UsageRecord = JSON.parse(line)
        stats.totalHitTokens += record.hit ?? 0
        stats.totalMissTokens += record.miss ?? 0
        stats.requestCount++
      } catch {
        continue
      }
    }
  } catch {
    // File read error, return empty stats
  }

  return stats
}

/**
 * Append a usage record to JSONL file
 */
export function appendUsageToJsonl(
  jsonlPath: string,
  hitTokens: number,
  missTokens: number
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
    }

    appendFileSync(jsonlPath, JSON.stringify(record) + "\n", "utf-8")
  } catch {
    // Silently ignore write errors
  }
}

export function createCacheStats(): CacheStats {
  return {
    totalHitTokens: 0,
    totalMissTokens: 0,
    requestCount: 0,
  }
}

export function getCacheReport(stats: CacheStats): string {
  const total = stats.totalHitTokens + stats.totalMissTokens
  const hitRate = total > 0 ? ((stats.totalHitTokens / total) * 100).toFixed(1) : "0.0"
  const savedCost =
    (stats.totalHitTokens / 1_000_000) * (DEEPSEEK_PRICES.cacheMiss - DEEPSEEK_PRICES.cacheHit)

  const statusIcon = Number(hitRate) >= 70 ? "🟢" : Number(hitRate) >= 30 ? "🟡" : "🔴"

  return `
### 📊 DeepSeek Cache Dashboard

| 核心指标 | 状态 |
| :--- | :--- |
| **缓存命中率** | ${statusIcon} **${hitRate}%** |
| **命中 Tokens** | \`${stats.totalHitTokens.toLocaleString()}\` |
| **未命中 Tokens** | \`${stats.totalMissTokens.toLocaleString()}\` |
| **累计请求数** | ${stats.requestCount} |
| **预估节省** | 💰 **$${savedCost.toFixed(6)}** |

> 💡 **优化提示**：命中部分按 $0.0028/1M 计费，未命中按 $0.14/1M 计费。保持 \`user_id\` 稳定以获得跨会话缓存收益。
`.trim()
}
