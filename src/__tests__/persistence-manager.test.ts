import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// State for controlling mock behavior
let shouldThrowOnNthCall = 0
let callCount = 0

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    appendFileSync: vi.fn((...args: [...Parameters<typeof actual.appendFileSync>]) => {
      callCount++
      if (shouldThrowOnNthCall > 0 && callCount === shouldThrowOnNthCall) {
        throw new Error('Disk full')
      }
      return actual.appendFileSync(...args)
    }),
  }
})

import * as fs from 'node:fs'
import { PersistenceManager } from '../persistence-manager.js'

describe('PersistenceManager — WAL Integrity', () => {
  let tmpDir: string
  let jsonlPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'persistence-test-'))
    jsonlPath = join(tmpDir, 'test.jsonl')
    callCount = 0
    shouldThrowOnNthCall = 0
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('C1: keeps record in queue when appendFileSync throws', () => {
    const pm = new PersistenceManager(jsonlPath)

    // Mock: throw on 2nd call
    shouldThrowOnNthCall = 2

    // Append two records
    pm.append(100, 50) // first call — succeeds
    pm.append(200, 75) // second call — throws

    // First record should be written, second should remain in queue
    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines.length).toBe(1) // only first record written

    // Now let second write succeed
    shouldThrowOnNthCall = 0 // reset so no more throws
    callCount = 0

    pm.append(300, 100) // triggers flushQueue again

    const content2 = fs.readFileSync(jsonlPath, 'utf-8')
    const lines2 = content2.trim().split('\n')
    expect(lines2.length).toBe(3) // all 3 records now written
  })

  it('flushes all records on success', () => {
    const pm = new PersistenceManager(jsonlPath)
    pm.append(100, 50)
    pm.append(200, 75)
    pm.append(300, 100)

    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines.length).toBe(3)
  })
})
