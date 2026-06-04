import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_LOG_SIZE } from './constants.js'
import { rotateFileIfNeeded } from './file-utils.js'

let LOG_DIR = ''
let LOG_FILE = ''
let stream: ReturnType<typeof createWriteStream> | null = null

// Bug fix #4/#9: Write buffer for backpressure handling
// When stream.write returns false, buffer lines and flush on 'drain' event
// Prevents log line loss under sustained write load
const MAX_WRITE_BUFFER = 50
let writeBuffer: string[] = []
let draining = false
/** Ensure write stream exists, creating if needed. Idempotent — multiple calls are safe. */
function ensureStream(): ReturnType<typeof createWriteStream> | null {
  if (stream && !stream.destroyed) return stream

  // Close old stream if it exists (HMR / re-init case)
  if (stream) {
    try {
      stream.end()
    } catch (err) {
      console.error('[deepseek-cache] Old stream cleanup error:', (err as Error).message)
    }
  }

  stream = createWriteStream(LOG_FILE, { flags: 'a' })
  stream.on('error', (err) => {
    console.error(`[deepseek-cache] Log stream error:`, err.message)
  })
  return stream
}

/** Bug fix #4/#9: Flush buffered writes when stream drains */
function flushBuffer(s: NonNullable<typeof stream>): void {
  try {
    while (writeBuffer.length > 0) {
      if (s.destroyed) {
        writeBuffer.length = 0
        return
      }
      if (!s.write(writeBuffer[0])) {
        // Still backpressured — re-register drain listener
        if (!draining) {
          draining = true
          s.once('drain', () => {
            draining = false
            flushBuffer(s)
          })
        }
        return
      }
      writeBuffer.shift()
    }
  } catch (err) {
    console.error(`[deepseek-cache] flushBuffer error:`, err)
    writeBuffer.length = 0
  }
}

/** Initialize logger with project directory. Must be called once before log(). */
export function initLogger(directory: string): void {
  const oldLogDir = join(directory, '.deepseek-cache-logs')
  LOG_DIR = join(directory, '.opencode', 'deepseek-cache-logs')
  LOG_FILE = join(LOG_DIR, 'debug.log')

  // Migration notice: v1.2 moved logs from .deepseek-cache-logs → .opencode/deepseek-cache-logs
  if (existsSync(oldLogDir) && !existsSync(LOG_DIR)) {
    console.warn(
      `[deepseek-cache] Log directory migrated: "${oldLogDir}" → "${LOG_DIR}".` +
        ' Old logs remain at the old path and will not be written to. You may delete the old directory.',
    )
  }

  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true })
    }
  } catch (err) {
    console.error(`[deepseek-cache] Failed to create log dir:`, (err as Error).message)
    return
  }

  // Create or reuse stream via ensureStream
  ensureStream()
}

export function dispose(): void {
  try {
    // Flush buffered writes before closing
    // Use cork/uncork to batch writes and ensure all data is flushed
    if (stream && !stream.destroyed && writeBuffer.length > 0) {
      stream.cork()
      for (const line of writeBuffer) {
        stream.write(line)
      }
      stream.uncork()
    }
    if (stream && !stream.destroyed) {
      stream.end()
    }
  } catch (err) {
    console.error(`[deepseek-cache] Dispose error:`, (err as Error).message)
  }
  stream = null
  writeBuffer = []
  draining = false
}

/**
 * Check log file size and rotate if needed.
 * Uses rename instead of delete to avoid data loss.
 */
function checkRotation(): void {
  if (!stream) return
  try {
    if (!existsSync(LOG_FILE)) return

    const rotated = rotateFileIfNeeded(LOG_FILE, MAX_LOG_SIZE, 3)
    if (!rotated) return

    // Bug fix: Flush buffered writes BEFORE ending old stream
    // Without this, buffered lines are lost when drain listener on old stream never fires
    if (writeBuffer.length > 0 && stream && !stream.destroyed) {
      try {
        stream.cork()
        for (const line of writeBuffer) {
          stream.write(line)
        }
        stream.uncork()
        writeBuffer.length = 0
        draining = false
      } catch (err) {
        console.error(
          `[deepseek-cache] Buffer flush error during rotation:`,
          (err as Error).message,
        )
      }
    }

    // Close old stream after rotation
    try {
      if (stream && !stream.destroyed) {
        stream.end()
      }
    } catch (err) {
      console.error(`[deepseek-cache] Stream end error:`, (err as Error).message)
    } finally {
      stream = null
    }

    ensureStream()
  } catch (err) {
    console.error(`[deepseek-cache] Rotation error:`, (err as Error).message)
  }
}

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    let line = `[${timestamp}] ${message}`

    if (data !== undefined) {
      try {
        line += ` ${JSON.stringify(data, null, 2)}`
      } catch {
        line += ' [Stringify Error]'
      }
    }

    line += '\n'

    // Rotate BEFORE acquiring stream so we never write to a dead stream
    checkRotation()

    const s = ensureStream()
    if (!s) return

    // Bug fix #4/#9: Buffer writes when stream has backpressure, flush on drain
    if (writeBuffer.length > 0) {
      // Already buffering — queue this line too
      writeBuffer.push(line)
      if (writeBuffer.length > MAX_WRITE_BUFFER) {
        writeBuffer.shift()
        console.warn('[deepseek-cache] Log buffer full, dropping oldest line')
      } // cap buffer size
      return
    }

    if (!s.write(line)) {
      // Backpressure detected — buffer subsequent writes
      writeBuffer.push(line)
      if (!draining) {
        draining = true
        s.once('drain', () => {
          draining = false
          flushBuffer(s)
        })
      }
    }
  } catch (err) {
    console.error(`[deepseek-cache] Log write error:`, (err as Error).message)
  }
}

export function getLogPath(): string {
  return LOG_FILE
}
