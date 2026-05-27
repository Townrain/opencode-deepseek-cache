import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEEPSEEK_PRICES } from './constants.js';
import { log } from './logger.js';
/**
 * Load historical stats from JSONL file
 */
export function loadStatsFromJsonl(jsonlPath) {
    const stats = createCacheStats();
    try {
        if (!existsSync(jsonlPath))
            return stats;
        const content = readFileSync(jsonlPath, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim());
        let lastFingerprint = null;
        for (const line of lines) {
            try {
                const record = JSON.parse(line);
                stats.totalHitTokens += record.hit ?? 0;
                stats.totalMissTokens += record.miss ?? 0;
                stats.requestCount++;
                // Track prefix changes
                if (record.fp && lastFingerprint && record.fp !== lastFingerprint) {
                    stats.prefixChanges++;
                }
                if (record.fp)
                    lastFingerprint = record.fp;
                // Track time range — defensive: record.t could be undefined if JSONL is corrupted
                const t = typeof record.t === 'number' ? record.t : Date.now();
                if (!stats.firstRequestTime)
                    stats.firstRequestTime = t;
                stats.lastRequestTime = t;
            }
            catch (err) {
                log('JSONL parse error', { line: line.slice(0, 100), error: String(err) });
            }
        }
    }
    catch {
        // File read error, return empty stats
    }
    return stats;
}
/**
 * Append a usage record to JSONL file
 */
export function appendUsageToJsonl(jsonlPath, hitTokens, missTokens, fingerprint) {
    try {
        // Ensure directory exists
        const dir = dirname(jsonlPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const record = {
            t: Date.now(),
            hit: hitTokens,
            miss: missTokens,
            ...(fingerprint ? { fp: fingerprint } : {}),
        };
        appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, 'utf-8');
    }
    catch {
        // Silently ignore write errors
    }
}
export function createCacheStats() {
    return {
        totalHitTokens: 0,
        totalMissTokens: 0,
        requestCount: 0,
        prefixChanges: 0,
        firstRequestTime: null,
        lastRequestTime: null,
    };
}
export function getCacheReport(stats, currentFingerprint, balance) {
    const total = stats.totalHitTokens + stats.totalMissTokens;
    const hitRate = total > 0 ? ((stats.totalHitTokens / total) * 100).toFixed(1) : '0.0';
    const savedCost = (stats.totalHitTokens / 1_000_000) * (DEEPSEEK_PRICES.cacheMiss - DEEPSEEK_PRICES.cacheHit);
    const actualCost = (stats.totalHitTokens / 1_000_000) * DEEPSEEK_PRICES.cacheHit +
        (stats.totalMissTokens / 1_000_000) * DEEPSEEK_PRICES.cacheMiss;
    const hypotheticalCost = (total / 1_000_000) * DEEPSEEK_PRICES.cacheMiss;
    const statusIcon = Number(hitRate) >= 70 ? '🟢' : Number(hitRate) >= 30 ? '🟡' : '🔴';
    // Session duration
    const duration = stats.firstRequestTime && stats.lastRequestTime
        ? Math.round((stats.lastRequestTime - stats.firstRequestTime) / 1000 / 60)
        : null;
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
${balance ? `- **账户余额**: 💵 ¥${Number(balance.total_balance).toFixed(2)} ${balance.currency}` : ''}

> 💡 命中部分按 ¥0.025/百万tokens 计费，未命中按 ¥3/百万tokens 计费。保持 user_id 稳定以获得跨会话缓存收益。

---
*📊 DeepSeek Cache Statistics Report*`;
}
//# sourceMappingURL=cache-stats.js.map