/**
 * Stats report generation — creates the DeepSeek Cache Dashboard.
 */

import { getPricingWithOverrides } from '../constants.js'
import type { CacheStats } from '../types.js'

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
