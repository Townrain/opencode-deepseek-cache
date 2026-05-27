import { describe, expect, it } from 'vitest';
import { computeFingerprint, createFingerprintTracker } from './fingerprint.js';
describe('computeFingerprint', () => {
    it('returns a hex string of FINGERPRINT_LENGTH (16)', () => {
        const fp = computeFingerprint('hello world');
        expect(fp).toHaveLength(16);
        expect(fp).toMatch(/^[0-9a-f]{16}$/);
    });
    it('returns deterministic output for same input', () => {
        const a = computeFingerprint('test string');
        const b = computeFingerprint('test string');
        expect(a).toBe(b);
    });
    it('returns different output for different inputs', () => {
        const a = computeFingerprint('hello');
        const b = computeFingerprint('world');
        expect(a).not.toBe(b);
    });
    it('returns empty string hash for empty input', () => {
        const fp = computeFingerprint('');
        expect(fp).toHaveLength(16);
        expect(fp).toMatch(/^[0-9a-f]{16}$/);
    });
});
describe('createFingerprintTracker', () => {
    it('starts with null lastFingerprint', () => {
        const tracker = createFingerprintTracker();
        expect(tracker.getLastFingerprint()).toBeNull();
    });
    describe('compute', () => {
        it('returns changed=false on first call', () => {
            const tracker = createFingerprintTracker();
            const result = tracker.compute('system prompt');
            expect(result.changed).toBe(false);
            expect(result.previous).toBeNull();
            expect(result.fingerprint).toHaveLength(16);
        });
        it('returns changed=false for same input', () => {
            const tracker = createFingerprintTracker();
            tracker.compute('system prompt');
            const result = tracker.compute('system prompt');
            expect(result.changed).toBe(false);
            expect(result.previous).toBe(result.fingerprint);
        });
        it('returns changed=true for different input', () => {
            const tracker = createFingerprintTracker();
            const first = tracker.compute('prompt A');
            const second = tracker.compute('prompt B');
            expect(second.changed).toBe(true);
            expect(second.previous).toBe(first.fingerprint);
            expect(second.fingerprint).not.toBe(first.fingerprint);
        });
        it('updates lastFingerprint after compute', () => {
            const tracker = createFingerprintTracker();
            const result = tracker.compute('test');
            expect(tracker.getLastFingerprint()).toBe(result.fingerprint);
        });
    });
    describe('hasChanged', () => {
        it('returns false when no previous fingerprint', () => {
            const tracker = createFingerprintTracker();
            expect(tracker.hasChanged('anything')).toBe(false);
        });
        it('returns false for same content as last compute', () => {
            const tracker = createFingerprintTracker();
            tracker.compute('stable prompt');
            expect(tracker.hasChanged('stable prompt')).toBe(false);
        });
        it('returns true for different content', () => {
            const tracker = createFingerprintTracker();
            tracker.compute('prompt A');
            expect(tracker.hasChanged('prompt B')).toBe(true);
        });
        it('does not mutate state', () => {
            const tracker = createFingerprintTracker();
            tracker.compute('original');
            tracker.hasChanged('different');
            // lastFingerprint should still be from the "original" compute
            expect(tracker.getLastFingerprint()).toBe(computeFingerprint('original'));
        });
    });
});
//# sourceMappingURL=fingerprint.test.js.map