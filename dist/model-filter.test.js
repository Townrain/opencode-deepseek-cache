import { describe, expect, it } from 'vitest';
import { isOfficialDeepSeekEndpoint, isOfficialDeepSeekProvider, isOfficialProvider, isValidCacheUsage, } from './model-filter.js';
describe('isOfficialProvider', () => {
    it('returns true for deepseek provider', () => {
        expect(isOfficialProvider('deepseek')).toBe(true);
    });
    it('returns false for third-party providers', () => {
        expect(isOfficialProvider('openai-compatible')).toBe(false);
        expect(isOfficialProvider('openrouter')).toBe(false);
        expect(isOfficialProvider('azure')).toBe(false);
        expect(isOfficialProvider('')).toBe(false);
    });
});
describe('isValidCacheUsage', () => {
    it('returns true for normal DeepSeek cache data', () => {
        expect(isValidCacheUsage(400000, 1000, 401000)).toBe(true);
    });
    it('returns true when hit+miss is within 10% tolerance of total', () => {
        expect(isValidCacheUsage(500, 500, 1000)).toBe(true);
        expect(isValidCacheUsage(600, 500, 1000)).toBe(true);
    });
    it('returns false when hit+miss exceeds 110% of total', () => {
        expect(isValidCacheUsage(700, 500, 1000)).toBe(false);
    });
    it('returns false for negative tokens', () => {
        expect(isValidCacheUsage(-1, 100, 100)).toBe(false);
        expect(isValidCacheUsage(100, -1, 100)).toBe(false);
    });
    it('returns false for negative totalInput', () => {
        expect(isValidCacheUsage(100, 100, -1)).toBe(false);
    });
    it('returns true when both hit and miss are zero', () => {
        expect(isValidCacheUsage(0, 0, 0)).toBe(true);
    });
    it('returns true for single-sided usage', () => {
        expect(isValidCacheUsage(1000, 0, 1000)).toBe(true);
        expect(isValidCacheUsage(0, 1000, 1000)).toBe(true);
    });
});
describe('isOfficialDeepSeekEndpoint', () => {
    it('returns true for api.deepseek.com', () => {
        expect(isOfficialDeepSeekEndpoint('https://api.deepseek.com/v1')).toBe(true);
        expect(isOfficialDeepSeekEndpoint('https://api.deepseek.com')).toBe(true);
    });
    it('returns false for third-party endpoints', () => {
        expect(isOfficialDeepSeekEndpoint('https://api.siliconflow.cn/v1')).toBe(false);
        expect(isOfficialDeepSeekEndpoint('https://api.openrouter.ai')).toBe(false);
    });
});
describe('isOfficialDeepSeekProvider', () => {
    it('returns true for deepseek provider', () => {
        expect(isOfficialDeepSeekProvider('deepseek')).toBe(true);
    });
    it('returns false for non-deepseek providers', () => {
        expect(isOfficialDeepSeekProvider('openai-compatible')).toBe(false);
        expect(isOfficialDeepSeekProvider('openrouter')).toBe(false);
        expect(isOfficialDeepSeekProvider('')).toBe(false);
    });
    it('handles case insensitivity', () => {
        expect(isOfficialDeepSeekProvider('DeepSeek')).toBe(true);
    });
});
//# sourceMappingURL=model-filter.test.js.map