import { createWriteStream, statSync, unlinkSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

const LOG_DIR = join(process.cwd(), ".deepseek-cache-logs")
const LOG_FILE = join(LOG_DIR, "debug.log")
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB

// Ensure log directory exists
try {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
} catch {
  // Ignore errors
}

// Create write stream (append mode)
let stream = createWriteStream(LOG_FILE, { flags: "a" })

/**
 * Check log file size and rotate if needed
 */
function checkRotation(): void {
  try {
    if (!existsSync(LOG_FILE)) return

    const stat = statSync(LOG_FILE)
    if (stat.size < MAX_LOG_SIZE) return

    // Rotate: close stream, delete old file, create new stream
    stream.end()
    unlinkSync(LOG_FILE)
    stream = createWriteStream(LOG_FILE, { flags: "a" })
  } catch {
    // Ignore rotation errors
  }
}

export function log(message: string, data?: any): void {
  try {
    const timestamp = new Date().toISOString()
    let line = `[${timestamp}] ${message}`

    if (data !== undefined) {
      try {
        line += ` ${JSON.stringify(data, null, 2)}`
      } catch {
        line += ` [Stringify Error]`
      }
    }

    line += "\n"

    // Check rotation before writing
    checkRotation()

    // Async write (non-blocking)
    stream.write(line)
  } catch {
    // Ignore write errors to prevent crash
  }
}

export function getLogPath(): string {
  return LOG_FILE
}
