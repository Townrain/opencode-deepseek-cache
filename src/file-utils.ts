import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, parse } from 'node:path'

// Per-file skip counters: prevents logger rotation from affecting JSONL rotation and vice versa
const statSkipCounters = new Map<string, number>()

/**
 * Reset skip counters for testing.
 * Only use in tests.
 */
export function resetSkipCounters(): void {
  statSkipCounters.clear()
}

/**
 * Rotate a file if it exceeds maxSize bytes.
 * Renames current file to file.{timestamp}, keeps at most keepCount rotated copies.
 * Returns true if rotation occurred.
 */
export function rotateFileIfNeeded(
  filePath: string,
  maxSize: number,
  keepCount: number = 3,
): boolean {
  try {
    if (!existsSync(filePath)) return false
    const count = (statSkipCounters.get(filePath) ?? 0) + 1
    statSkipCounters.set(filePath, count)
    if (count % 10 !== 0) return false
    const stat = statSync(filePath)
    if (stat.size < maxSize) return false

    const rotated = `${filePath}.${Date.now()}`
    renameSync(filePath, rotated)

    // Clean up old rotated files, keeping only the latest keepCount
    const dir = dirname(filePath)
    const base = basename(filePath)
    const rotatedFiles = readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.`))
      .sort()
    if (rotatedFiles.length > keepCount) {
      for (const old of rotatedFiles.slice(0, rotatedFiles.length - keepCount)) {
        try {
          unlinkSync(join(dir, old))
        } catch {
          /* best-effort cleanup */
        }
      }
    }

    return true
  } catch {
    return false
  }
}

/**
 * Walk up from startDir looking for a .git directory.
 * Returns the git root path if found, or empty string when no .git is found.
 */
export function findGitRoot(startDir: string): string {
  const { root } = parse(startDir)
  let dir = startDir
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir || parent === root) return ''
    dir = parent
  }
}

/**
 * Normalize a git root path for cross-platform user_id consistency.
 * - Converts backslashes to forward slashes
 * - Normalizes WSL2 /mnt/[drive]/ paths to Windows drive letter form
 * - Lowercases path segments for case-insensitivity
 * - Preserves drive letter uppercase (D: not d:)
 *
 * This ensures Windows and WSL2 produce identical user_id hashes,
 * enabling cross-terminal KV Cache pooling.
 */
export function normalizeGitRoot(path: string): string {
  if (!path) return path

  // Step 1: Convert backslashes to forward slashes
  let normalized = path.replace(/\\/g, '/')

  // Step 2: Normalize WSL2 /mnt/[drive]/ paths to Windows drive letter form
  // e.g., /mnt/d/foo/bar → D:/foo/bar
  normalized = normalized.replace(
    /^\/mnt\/([a-zA-Z])\//,
    (_, drive: string) => `${drive.toUpperCase()}:/`,
  )

  // Step 2.5: Normalize Windows drive letter to uppercase (d: → D:)
  normalized = normalized.replace(/^([a-zA-Z]):/, (_, drive: string) => `${drive.toUpperCase()}:`)

  // Step 3: Lowercase for case-insensitivity, preserving drive letter uppercase
  const driveMatch = normalized.match(/^([A-Z]:)(.*)$/)
  if (driveMatch) {
    normalized = driveMatch[1] + driveMatch[2].toLowerCase()
  } else {
    normalized = normalized.toLowerCase()
  }

  return normalized
}
