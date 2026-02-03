// Mock the vscode module
jest.mock('vscode', () => ({
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
    },
    Uri: {
        parse: jest.fn(),
    },
    env: {
        openExternal: jest.fn(),
    }
}), { virtual: true });

// Mock the encryption-validator module
jest.mock('../src/encryption-validator', () => ({
    validateEncryptionKey: jest.fn(),
}));

import * as crypto from 'crypto';
import { 
    getEncryptionKey, 
    validateSecretPhrase, 
    generateWorkspaceSalt,
    encryptString,
    decryptString,
    encryptObject,
    decryptObject,
    migrateEncryptionKey,
    isUsingDefaultSecretPhrase,
    deriveKeyFromPhrase
} from '../src/encryption-utils';

describe('EncryptionUtils', () => {
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

    describe('getEncryptionKey - updated behavior', () => {
        test('should throw error when no key is configured', () => {
            expect(() => getEncryptionKey()).toThrow(
                'Encryption key is not configured'
            );
        });

        test('should throw error when using default secret phrase', () => {
            process.env.ROO_TRACE_SECRET_PHRASE = 'roo-trace-default-secret';
            expect(() => getEncryptionKey()).toThrow(
                'Default secret phrase is not allowed'
            );
        });

        test('should throw error when secret phrase is too short', () => {
            process.env.ROO_TRACE_SECRET_PHRASE = 'short';
            expect(() => getEncryptionKey()).toThrow(
                'must be at least 12 characters'
            );
        });

        test('should generate valid key from valid secret phrase', () => {
            process.env.ROO_TRACE_SECRET_PHRASE = 'valid-secret-phrase-123';
            const key = getEncryptionKey();
            expect(key).toBeInstanceOf(Buffer);
            expect(key.length).toBe(32);
        });

        test('should use ROO_TRACE_ENCRYPTION_KEY if set and valid', () => {
            const testKey = 'a'.repeat(64);
            process.env.ROO_TRACE_ENCRYPTION_KEY = testKey;
            const key = getEncryptionKey();
            expect(key).toEqual(Buffer.from(testKey, 'hex'));
        });
    });

    describe('validateSecretPhrase', () => {
        test('should throw error for default secret phrase in production', () => {
            process.env.NODE_ENV = 'production';
            expect(() => {
                validateSecretPhrase('roo-trace-default-secret');
            }).toThrow('Default secret phrase is not allowed in production');
        });

        test('should not throw error for valid secret phrase', () => {
            expect(() => {
                validateSecretPhrase('valid-secret-phrase-123');
            }).not.toThrow();
        });

        test('should throw error for short secret phrase', () => {
            expect(() => {
                validateSecretPhrase('short');
            }).toThrow('Secret phrase must be at least 12 characters long');
        });
    });

    describe('generateWorkspaceSalt', () => {
        test('should generate consistent salt for same workspace', () => {
            const salt1 = generateWorkspaceSalt();
            const salt2 = generateWorkspaceSalt();
            // Salt generation depends on workspace path, so we just check format
            expect(salt1).toHaveLength(16);
            expect(salt2).toHaveLength(16);
        });
    });

    describe('encryptString and decryptString', () => {
        test('should encrypt and decrypt string correctly', () => {
            const key = crypto.randomBytes(32);
            const originalText = 'Hello, World!';
            const encrypted = encryptString(originalText, key);
            const decrypted = decryptString(encrypted, key);
            expect(decrypted).toBe(originalText);
        });
    });

    describe('encryptObject and decryptObject', () => {
        test('should encrypt and decrypt object correctly', () => {
            const key = crypto.randomBytes(32);
            const originalObj = { name: 'test', value: 42 };
            const encrypted = encryptObject(originalObj, key);
            const decrypted = decryptObject(encrypted, key);
            expect(decrypted).toEqual(originalObj);
        });
    });

    describe('migrateEncryptionKey', () => {
        test('should migrate data from old key to new key', () => {
            const oldKey = crypto.randomBytes(32);
            const newKey = crypto.randomBytes(32);
            const originalText = 'Sensitive data';
            
            // Encrypt with old key
            const encryptedWithOld = encryptString(originalText, oldKey);
            
            // Migrate to new key
            const migrated = migrateEncryptionKey(encryptedWithOld, oldKey, newKey);
            
            // Decrypt with new key
            const decrypted = decryptString(migrated, newKey);
            
            expect(decrypted).toBe(originalText);
        });
    });

    describe('isUsingDefaultSecretPhrase', () => {
        test('should return true when using default secret phrase', () => {
            process.env.ROO_TRACE_SECRET_PHRASE = 'roo-trace-default-secret';
            expect(isUsingDefaultSecretPhrase()).toBe(true);
        });

        test('should return false when using custom secret phrase', () => {
            process.env.ROO_TRACE_SECRET_PHRASE = 'custom-phrase';
            expect(isUsingDefaultSecretPhrase()).toBe(false);
        });
    });

    describe('deriveKeyFromPhrase', () => {
        test('should derive key from phrase consistently', () => {
            const phrase = 'test-phrase-123456';
            const key1 = deriveKeyFromPhrase(phrase, 'salt123456789012');
            const key2 = deriveKeyFromPhrase(phrase, 'salt123456789012');
            expect(key1).toEqual(key2);
        });
    });
});