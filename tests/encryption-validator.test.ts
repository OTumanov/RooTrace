import { validateEncryptionKey, isEncryptionKeyConfigured } from '../src/encryption-validator';

describe('EncryptionValidator', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ROO_TRACE_ENCRYPTION_KEY;
    delete process.env.ROO_TRACE_SECRET_PHRASE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateEncryptionKey', () => {
    test('should throw error when no key is configured', () => {
      expect(() => validateEncryptionKey()).toThrow(
        'Encryption key is not configured'
      );
    });

    test('should throw error when using default secret phrase', () => {
      process.env.ROO_TRACE_SECRET_PHRASE = 'roo-trace-default-secret';
      expect(() => validateEncryptionKey()).toThrow(
        'Default secret phrase is not allowed'
      );
    });

    test('should throw error when secret phrase is too short', () => {
      process.env.ROO_TRACE_SECRET_PHRASE = 'short';
      expect(() => validateEncryptionKey()).toThrow(
        'must be at least 12 characters'
      );
    });

    test('should throw error when encryption key has invalid format', () => {
      process.env.ROO_TRACE_ENCRYPTION_KEY = 'invalid';
      expect(() => validateEncryptionKey()).toThrow(
        'Invalid ROO_TRACE_ENCRYPTION_KEY format'
      );
    });

    test('should throw error when encryption key has wrong length', () => {
      // 62 hex characters (31 bytes) - valid hex but wrong length
      process.env.ROO_TRACE_ENCRYPTION_KEY = 'aa'.repeat(31);
      expect(() => validateEncryptionKey()).toThrow(/length/);
      // 66 hex characters (33 bytes) - valid hex but wrong length
      process.env.ROO_TRACE_ENCRYPTION_KEY = 'aa'.repeat(33);
      expect(() => validateEncryptionKey()).toThrow(/length/);
    });

    test('should accept valid 64-character hex encryption key', () => {
      process.env.ROO_TRACE_ENCRYPTION_KEY = 'a'.repeat(64);
      expect(() => validateEncryptionKey()).not.toThrow();
    });

    test('should accept valid secret phrase', () => {
      process.env.ROO_TRACE_SECRET_PHRASE = 'valid-secret-phrase-123';
      expect(() => validateEncryptionKey()).not.toThrow();
    });
  });

  describe('isEncryptionKeyConfigured', () => {
    test('should return false when no key is configured', () => {
      expect(isEncryptionKeyConfigured()).toBe(false);
    });

    test('should return false when using default secret phrase', () => {
      process.env.ROO_TRACE_SECRET_PHRASE = 'roo-trace-default-secret';
      expect(isEncryptionKeyConfigured()).toBe(false);
    });

    test('should return false when secret phrase is too short', () => {
      process.env.ROO_TRACE_SECRET_PHRASE = 'short';
      expect(isEncryptionKeyConfigured()).toBe(false);
    });

    test('should return true for valid encryption key', () => {
      process.env.ROO_TRACE_ENCRYPTION_KEY = 'a'.repeat(64);
      expect(isEncryptionKeyConfigured()).toBe(true);
    });

    test('should return true for valid secret phrase', () => {
      process.env.ROO_TRACE_SECRET_PHRASE = 'valid-secret-phrase-123';
      expect(isEncryptionKeyConfigured()).toBe(true);
    });
  });
});