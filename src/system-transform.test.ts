import { describe, expect, it } from 'vitest'
import { needsNormalization, normalizeSystemPrompt } from './system-transform.js'

describe('normalizeSystemPrompt', () => {
  it('returns unchanged=false for empty array', () => {
    const result = normalizeSystemPrompt([])
    expect(result.changed).toBe(false)
    expect(result.replacements).toBe(0)
    expect(result.fingerprint).toBe('')
  })

  it('returns unchanged=false for null/undefined-like input', () => {
    const result = normalizeSystemPrompt(null as any)
    expect(result.changed).toBe(false)
  })

  it('returns unchanged=false when no dynamic content present', () => {
    const system = ['You are a helpful assistant.']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(false)
    expect(result.replacements).toBe(0)
    expect(system[0]).toBe('You are a helpful assistant.')
  })

  it('replaces ISO timestamps', () => {
    const system = ['Current time is 2025-01-15T10:30:00Z.']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(result.replacements).toBe(1)
    expect(system[0]).toBe('Current time is [TIME].')
  })

  it('replaces UUIDs', () => {
    const system = ['Session: 550e8400-e29b-41d4-a716-446655440000']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(system[0]).toBe('Session: [ID]')
  })

  it('replaces version strings', () => {
    const system = ['Running v2.1.0-beta.3']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(system[0]).toBe('Running [VERSION]')
  })

  it('replaces date strings (abbreviated)', () => {
    const system = ['Date: Mon Jan 15 2025']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(system[0]).toBe('Date: [DATE]')
  })

  it('replaces date strings (full month)', () => {
    const system = ['Date: January 15, 2025']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(system[0]).toBe('Date: [DATE]')
  })

  it('replaces temp paths (Unix)', () => {
    const system = ['File at /tmp/abc123']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(system[0]).toBe('File at [TEMP]')
  })

  it('replaces temp paths (Windows)', () => {
    const system = ['File at C:\\Users\\john\\AppData\\Local\\Temp\\abc123']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(system[0]).toBe('File at [TEMP]')
  })

  it('replaces process IDs', () => {
    const system = ['Process at /proc/12345']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(system[0]).toBe('Process at [PID]')
  })

  it('replaces multiple patterns in one string', () => {
    const system = ['Time 2025-01-15T10:30:00Z id 550e8400-e29b-41d4-a716-446655440000']
    const result = normalizeSystemPrompt(system)
    expect(result.replacements).toBe(2)
    expect(system[0]).toBe('Time [TIME] id [ID]')
  })

  it('handles multiple array elements', () => {
    const system = [
      'System time: 2025-01-15T10:30:00Z',
      'Session: 550e8400-e29b-41d4-a716-446655440000',
      'Static text',
    ]
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(result.replacements).toBe(2)
    expect(system[0]).toBe('System time: [TIME]')
    expect(system[1]).toBe('Session: [ID]')
    expect(system[2]).toBe('Static text')
  })

  it('returns a valid fingerprint', () => {
    const system = ['test']
    const result = normalizeSystemPrompt(system)
    expect(result.fingerprint).toHaveLength(16)
    expect(result.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('skips non-string elements', () => {
    const system: any[] = ['Valid text', 123, null, 'More text 2025-01-15T10:30:00Z']
    const result = normalizeSystemPrompt(system)
    expect(result.changed).toBe(true)
    expect(result.replacements).toBe(1)
  })
})

describe('needsNormalization', () => {
  it('returns false for empty array', () => {
    expect(needsNormalization([])).toBe(false)
  })

  it('returns false for null/undefined-like input', () => {
    expect(needsNormalization(null as any)).toBe(false)
  })

  it('returns false for static content', () => {
    expect(needsNormalization(['You are helpful.'])).toBe(false)
  })

  it('returns true when timestamps present', () => {
    expect(needsNormalization(['Time: 2025-01-15T10:30:00Z'])).toBe(true)
  })

  it('returns true when UUIDs present', () => {
    expect(needsNormalization(['ID: 550e8400-e29b-41d4-a716-446655440000'])).toBe(true)
  })

  it('returns true when version strings present', () => {
    expect(needsNormalization(['Version: v1.2.3'])).toBe(true)
  })

  it('returns true when temp paths present', () => {
    expect(needsNormalization(['Path: /tmp/abc'])).toBe(true)
  })

  it('does not modify the input array', () => {
    const system = ['Time: 2025-01-15T10:30:00Z']
    const original = system[0]
    needsNormalization(system)
    expect(system[0]).toBe(original)
  })
})
