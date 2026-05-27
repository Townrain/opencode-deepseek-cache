import { createHash } from "crypto";
import { join } from "path";
import { tool } from "@opencode-ai/plugin";
import { log, getLogPath } from "./logger.js";
import { normalizeSystemPrompt } from "./system-transform.js";
import { loadStatsFromJsonl, appendUsageToJsonl, getCacheReport } from "./cache-stats.js";
import { createFingerprintTracker } from "./fingerprint.js";
const DeepSeekCachePlugin = async (ctx) => {
    // JSONL file path in project's .opencode directory
    const projectPath = ctx.directory || process.cwd();
    const jsonlPath = join(projectPath, ".opencode", "deepseek-cache-usage.jsonl");
    // Load historical stats from JSONL (survives restarts)
    const stats = loadStatsFromJsonl(jsonlPath);
    // Fingerprint tracker for prefix stability monitoring
    const fingerprintTracker = createFingerprintTracker();
    try {
        // Generate stable user_id from project path (SHA-256 for consistency with fingerprint.ts)
        const projectHash = createHash("sha256").update(projectPath).digest("hex").slice(0, 16);
        const stableUserId = `opencode-${projectHash}`;
        log("=== Plugin Loaded ===", { projectPath, stableUserId, logPath: getLogPath() });
        return {
            // Register custom command /cache-stats
            config: async (config) => {
                try {
                    config.command = config.command || {};
                    config.command["cache-stats"] = {
                        template: "Show DeepSeek cache statistics",
                        description: "显示 DeepSeek 缓存命中统计面板",
                    };
                    log("Registered /cache-stats command");
                }
                catch (err) {
                    log("ERROR in config hook", { error: String(err) });
                }
            },
            // Intercept /cache-stats command execution
            // HACK: output.parts assignment relies on OpenCode's internal behavior.
            // The hook's type signature doesn't guarantee this will short-circuit the LLM call.
            // If OpenCode changes how command.execute.before handles output.parts, this will fail silently.
            "command.execute.before": async (input, output) => {
                try {
                    if (input.command === "cache-stats") {
                        log("Intercepted /cache-stats command");
                        const currentFp = fingerprintTracker.getLastFingerprint();
                        const report = getCacheReport(stats, currentFp ?? undefined);
                        // HACK: as any[] because the hook's type doesn't explicitly support this pattern
                        output.parts = [{
                                type: "text",
                                text: report,
                            }];
                        log("Returned cache stats directly");
                    }
                }
                catch (err) {
                    log("ERROR in command.execute.before", { error: String(err) });
                }
            },
            // Core 1: Inject stable user_id for cross-terminal cache pooling
            // HACK: output.options.user_id relies on OpenCode passing this through to DeepSeek's API.
            // The hook's type signature shows output.options is Record<string, any>, but there's no
            // guarantee that OpenCode will forward user_id to the provider. If OpenCode changes how
            // it handles provider-specific options, this injection will fail silently.
            "chat.params": async (input, output) => {
                try {
                    // Only apply to DeepSeek models
                    if (!input.model?.id?.toLowerCase()?.includes("deepseek")) {
                        return;
                    }
                    // Inject stable user_id for cache isolation
                    if (output && output.options) {
                        output.options.user_id = stableUserId;
                        log("Injected user_id", { stableUserId, model: input.model?.id });
                    }
                }
                catch (err) {
                    log("ERROR in chat.params", { error: String(err) });
                }
            },
            // Core 2: System prompt normalization to prevent cache avalanche
            // Enhanced from Reasonix ImmutablePrefix with fingerprint tracking
            "experimental.chat.system.transform": async (input, output) => {
                try {
                    const result = normalizeSystemPrompt(output.system);
                    // Track fingerprint changes
                    const fpResult = fingerprintTracker.compute(result.fingerprint);
                    if (result.changed) {
                        log("System prompt normalized", {
                            replacements: result.replacements,
                            fingerprint: result.fingerprint,
                            prefixChanged: fpResult.changed,
                            previousFingerprint: fpResult.previous,
                        });
                    }
                    if (fpResult.changed) {
                        stats.prefixChanges++;
                        log("⚠️ Prefix fingerprint changed — cache miss expected", {
                            previous: fpResult.previous,
                            current: fpResult.fingerprint,
                        });
                    }
                }
                catch (err) {
                    log("ERROR in system.transform", { error: String(err) });
                }
            },
            // NOTE: messages.transform is intentionally NOT used
            // OpenCode's native Compaction mechanism handles context management
            // Our sliding window would conflict with it
            // Event handler for cache statistics
            event: async ({ event }) => {
                try {
                    if (event.type !== "session.idle")
                        return;
                    // TypeScript can narrow the type after the type check above
                    // EventSessionIdle has properties.sessionID as required field
                    const sessionID = event.properties?.sessionID;
                    if (!sessionID)
                        return;
                    // Fetch session data with timeout
                    const timeout = 5000;
                    const response = await Promise.race([
                        ctx.client.session.get({ path: { id: sessionID } }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("session.get timeout")), timeout)),
                    ]);
                    if (response.error || !response.data)
                        return;
                    const session = response.data;
                    // Only collect stats for DeepSeek models
                    const modelID = session.model?.id?.toLowerCase?.() ?? "";
                    if (!modelID.includes("deepseek"))
                        return;
                    const tokens = session.tokens;
                    if (!tokens)
                        return;
                    const hitTokens = tokens.cache?.read ?? 0;
                    // DEFENSIVE: tokens.input semantics depend on OpenCode's getUsage() implementation.
                    // Currently: tokens.input = total input - cache hit tokens (pure miss tokens).
                    // If OpenCode changes this semantics, our stats will be incorrect.
                    // We validate by checking if input + cache hit <= total input tokens.
                    const missTokens = tokens.input ?? 0;
                    // Sanity check: hit + miss should not exceed total input tokens
                    // If it does, the token semantics may have changed
                    const totalInput = tokens.inputTotal ?? (hitTokens + missTokens);
                    if (hitTokens + missTokens > totalInput * 1.1) {
                        // Allow 10% tolerance for rounding
                        log("⚠️ Token count anomaly detected — OpenCode token semantics may have changed", {
                            hitTokens,
                            missTokens,
                            totalInput,
                            modelID,
                        });
                    }
                    if (hitTokens === 0 && missTokens === 0)
                        return;
                    // Record usage (in-memory)
                    stats.totalHitTokens += hitTokens;
                    stats.totalMissTokens += missTokens;
                    stats.requestCount++;
                    // Update time tracking
                    const now = Date.now();
                    if (!stats.firstRequestTime)
                        stats.firstRequestTime = now;
                    stats.lastRequestTime = now;
                    // Persist to JSONL with fingerprint (survives restarts)
                    const currentFp = fingerprintTracker.getLastFingerprint();
                    appendUsageToJsonl(jsonlPath, hitTokens, missTokens, currentFp ?? undefined);
                    // Avoid NaN% when both hit and miss are 0
                    const total = stats.totalHitTokens + stats.totalMissTokens;
                    const rate = total > 0 ? ((stats.totalHitTokens / total) * 100).toFixed(1) + "%" : "0.0%";
                    log("Recorded usage", {
                        hitTokens,
                        missTokens,
                        requests: stats.requestCount,
                        rate,
                        fingerprint: currentFp,
                    });
                }
                catch (err) {
                    log("ERROR in event handler", { error: String(err) });
                }
            },
            // Custom tool for cache statistics dashboard (AI-callable)
            tool: {
                cacheStats: tool({
                    description: "查看 DeepSeek 上下文缓存命中统计面板",
                    args: {},
                    async execute() {
                        try {
                            return getCacheReport(stats);
                        }
                        catch (err) {
                            log("ERROR in cacheStats", { error: String(err) });
                            return "Error generating report";
                        }
                    },
                }),
            },
        };
    }
    catch (err) {
        log("FATAL ERROR in plugin initialization", { error: String(err) });
        return {};
    }
};
// Export as PluginModule (V1 format) with id and server
const pluginModule = {
    id: "deepseek-cache",
    server: DeepSeekCachePlugin,
};
export default pluginModule;
//# sourceMappingURL=index.js.map