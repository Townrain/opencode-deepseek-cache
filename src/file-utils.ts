import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, parse } from 'node:path'

let statSkipCounter = 0

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
    statSkipCounter++
    if (statSkipCounter % 10 !== 0) return false  // only check size every 10 calls
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
