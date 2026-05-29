import { describe, expect, it, vi } from 'vitest'

// Mock fs — only what findGitRoot needs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

const fs = await import('node:fs')
const { join } = await import('node:path')

import { findGitRoot } from './file-utils.js'

describe('findGitRoot', () => {
  it('returns git root when .git found in ancestor', () => {
    // S1: Start deep in a monorepo, .git exists at project root
    const startDir = join('D:', 'home', 'user', 'monorepo', 'packages', 'frontend')
    const gitRoot = join('D:', 'home', 'user', 'monorepo')

    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      const str = typeof p === 'string' ? p : String(p)
      return str === join(gitRoot, '.git')
    })

    expect(findGitRoot(startDir)).toBe(gitRoot)
  })

  it('returns empty string when no .git found in ancestors', () => {
    // S2: No .git anywhere up to filesystem root → returns empty string
    const startDir = join('D:', 'home', 'user', 'orphan-project', 'src')

    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(findGitRoot(startDir)).toBe('')
  })

  it('stops at filesystem root and returns empty string when no .git', () => {
    // S3: Edge case — startDir is one level below root
    const startDir = join('D:', 'only-child')

    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(findGitRoot(startDir)).toBe('')
  })
})
