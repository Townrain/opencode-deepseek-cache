import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_LOG_SIZE } from './constants.js'
import { rotateFileIfNeeded } from './file-utils.js'


let LOG_DIR = ''
let LOG_FILE = ''
let stream: ReturnType<typeof createWriteStream> | null = null

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
    if (stream && !stream.destroyed) {
      stream.end()
    }
  } catch (err) {
    console.error(`[deepseek-cache] Dispose error:`, (err as Error).message)
  }
  stream = null
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

export function log(message: string, data?: any): void {
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

    const canContinue = s.write(line)
    if (!canContinue) {
      console.error('[deepseek-cache] Backpressure: log write deferred')
    }
  } catch (err) {
    console.error(`[deepseek-cache] Log write error:`, (err as Error).message)
  }
}

export function getLogPath(): string {
  return LOG_FILE
}
