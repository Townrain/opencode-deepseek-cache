import { describe, expect, it } from 'vitest'
import {
  isOfficialDeepSeekEndpoint,
  isOfficialDeepSeekProvider,
  isOfficialProvider,
} from './model-filter.js'

describe('isOfficialProvider', () => {
  it('returns true for deepseek provider', () => {
    expect(isOfficialProvider('deepseek')).toBe(true)
  })
  it('returns false for third-party providers', () => {
    expect(isOfficialProvider('openai-compatible')).toBe(false)
    expect(isOfficialProvider('openrouter')).toBe(false)
    expect(isOfficialProvider('azure')).toBe(false)
    expect(isOfficialProvider('')).toBe(false)
  })
})

describe('isOfficialDeepSeekEndpoint', () => {
  it('returns true for api.deepseek.com', () => {
    expect(isOfficialDeepSeekEndpoint('https://api.deepseek.com/v1')).toBe(true)
    expect(isOfficialDeepSeekEndpoint('https://api.deepseek.com')).toBe(true)
  })
  it('returns false for third-party endpoints', () => {
    expect(isOfficialDeepSeekEndpoint('https://api.siliconflow.cn/v1')).toBe(false)
    expect(isOfficialDeepSeekEndpoint('https://api.openrouter.ai')).toBe(false)
  })
})

describe('isOfficialDeepSeekProvider', () => {
  it('returns true for deepseek provider', () => {
    expect(isOfficialDeepSeekProvider('deepseek')).toBe(true)
  })
  it('returns false for non-deepseek providers', () => {
    expect(isOfficialDeepSeekProvider('openai-compatible')).toBe(false)
    expect(isOfficialDeepSeekProvider('openrouter')).toBe(false)
    expect(isOfficialDeepSeekProvider('')).toBe(false)
  })
  it('handles case insensitivity', () => {
    expect(isOfficialDeepSeekProvider('DeepSeek')).toBe(true)
  })
})
