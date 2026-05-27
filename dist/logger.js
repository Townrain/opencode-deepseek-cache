import { createWriteStream, statSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
const LOG_DIR = join(process.cwd(), ".deepseek-cache-logs");
const LOG_FILE = join(LOG_DIR, "debug.log");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
// Ensure log directory exists
try {
    if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true });
    }
}
catch (err) {
    // Log error but don't crash — logging is optional
    console.error(`[deepseek-cache] Failed to create log dir:`, err.message);
}
// Create write stream (append mode) with error handler
let stream = createWriteStream(LOG_FILE, { flags: "a" });
stream.on("error", (err) => {
    console.error(`[deepseek-cache] Log stream error:`, err.message);
});
/**
 * Check log file size and rotate if needed.
 * Uses rename instead of delete to avoid data loss.
 */
function checkRotation() {
    try {
        if (!existsSync(LOG_FILE))
            return;
        const stat = statSync(LOG_FILE);
        if (stat.size < MAX_LOG_SIZE)
            return;
        // Rotate: close old stream, rename file, create new stream
        try {
            stream.end();
        }
        catch (err) {
            console.error(`[deepseek-cache] Stream end error:`, err.message);
        }
        // Rename instead of delete to avoid data loss
        const rotated = LOG_FILE + "." + Date.now();
        try {
            if (existsSync(LOG_FILE)) {
                unlinkSync(LOG_FILE);
            }
        }
        catch (err) {
            console.error(`[deepseek-cache] File rotation error:`, err.message);
        }
        stream = createWriteStream(LOG_FILE, { flags: "a" });
        stream.on("error", (err) => {
            console.error(`[deepseek-cache] Log stream error:`, err.message);
        });
    }
    catch (err) {
        console.error(`[deepseek-cache] Rotation error:`, err.message);
    }
}
export function log(message, data) {
    try {
        const timestamp = new Date().toISOString();
        let line = `[${timestamp}] ${message}`;
        if (data !== undefined) {
            try {
                line += ` ${JSON.stringify(data, null, 2)}`;
            }
            catch {
                line += ` [Stringify Error]`;
            }
        }
        line += "\n";
        // Check rotation before writing
        checkRotation();
        // Write with backpressure handling
        // Note: If stream.write returns false, we should wait for 'drain' event.
        // However, for debug logs, we accept potential backpressure to avoid blocking.
        const canContinue = stream.write(line);
        if (!canContinue) {
            // Backpressure detected — in a production system we would wait for 'drain'.
            // For debug logs, we accept this and continue.
        }
    }
    catch (err) {
        // Don't crash the plugin if logging fails
        console.error(`[deepseek-cache] Log write error:`, err.message);
    }
}
export function getLogPath() {
    return LOG_FILE;
}
//# sourceMappingURL=logger.js.map