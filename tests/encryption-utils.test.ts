import * as fs from 'fs';
import * as path from 'path';
import { 
  generateEncryptionKey, 
  encryptString, 
  decryptString, 
  encryptObject, 
  decryptObject, 
  getEncryptionKey 
} from '../src/encryption-utils';

describe('EncryptionUtils', () => {
  describe('generateEncryptionKey', () => {
    test('should generate a 32-byte key', () => {
      const key = generateEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32); // 32 bytes = 256 bits
    });

    test('should generate different keys each time', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('encryptString and decryptString', () => {
    test('should encrypt and decrypt a string correctly', () => {
      const key = generateEncryptionKey();
      const originalText = 'This is a test string for encryption';
      
      const encrypted = encryptString(originalText, key);
      const decrypted = decryptString(encrypted, key);
      
      expect(decrypted).toBe(originalText);
    });

    test('should handle special characters', () => {
      const key = generateEncryptionKey();
      const originalText = 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?~`';
      
      const encrypted = encryptString(originalText, key);
      const decrypted = decryptString(encrypted, key);
      
      expect(decrypted).toBe(originalText);
    });

    test('should handle empty string', () => {
      const key = generateEncryptionKey();
      const originalText = '';
      
      const encrypted = encryptString(originalText, key);
      const decrypted = decryptString(encrypted, key);
      
      expect(decrypted).toBe(originalText);
    });

    test('should fail to decrypt with wrong key', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      const originalText = 'This is a test string for encryption';
      
      const encrypted = encryptString(originalText, key1);
      
      expect(() => decryptString(encrypted, key2)).toThrow();
    });
  });

  describe('encryptObject and decryptObject', () => {
    test('should encrypt and decrypt a simple object correctly', () => {
      const key = generateEncryptionKey();
      const originalObj = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com'
      };
      
      const encrypted = encryptObject(originalObj, key);
      const decrypted = decryptObject(encrypted, key);
      
      expect(decrypted).toEqual(originalObj);
    });

    test('should encrypt and decrypt a complex nested object correctly', () => {
      const key = generateEncryptionKey();
      const originalObj = {
        user: {
          id: 123,
          profile: {
            name: 'Jane Doe',
            settings: {
              theme: 'dark',
              notifications: true
            }
          }
        },
        permissions: ['read', 'write'],
        metadata: {
          createdAt: new Date().toISOString(),
          tags: ['important', 'user']
        }
      };
      
      const encrypted = encryptObject(originalObj, key);
      const decrypted = decryptObject(encrypted, key);
      
      expect(decrypted).toEqual(originalObj);
    });

    test('should handle arrays', () => {
      const key = generateEncryptionKey();
      const originalArr = [1, 2, 3, 'four', { five: 6 }];
      
      const encrypted = encryptObject(originalArr, key);
      const decrypted = decryptObject(encrypted, key);
      
      expect(decrypted).toEqual(originalArr);
    });

    test('should handle null and undefined values', () => {
      const key = generateEncryptionKey();
      const originalObj = {
        nullValue: null,
        undefinedValue: undefined,
        actualValue: 'exists'
      };
      
      const encrypted = encryptObject(originalObj, key);
      const decrypted = decryptObject(encrypted, key);
      
      expect(decrypted).toEqual(originalObj);
    });
  });

  describe('getEncryptionKey', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('should generate key from ROO_TRACE_SECRET_PHRASE if ROO_TRACE_ENCRYPTION_KEY is not set', () => {
      process.env.ROO_TRACE_SECRET_PHRASE = 'test-secret-phrase';
      const { getEncryptionKey } = require('../src/encryption-utils');
      const key = getEncryptionKey();
      
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    test('should use ROO_TRACE_ENCRYPTION_KEY if it is set', () => {
      const testKey = generateEncryptionKey();
      process.env.ROO_TRACE_ENCRYPTION_KEY = testKey.toString('hex');
      const { getEncryptionKey } = require('../src/encryption-utils');
      const key = getEncryptionKey();
      
      expect(key).toEqual(testKey);
    });

    test('should throw error if ROO_TRACE_ENCRYPTION_KEY has invalid length', () => {
      process.env.ROO_TRACE_ENCRYPTION_KEY = 'invalid-length-key';
      const { getEncryptionKey } = require('../src/encryption-utils');
      
      expect(() => getEncryptionKey()).toThrow('Invalid encryption key length');
    });
  });

  describe('Integration tests', () => {
    test('should encrypt and decrypt config-like object', () => {
      const key = generateEncryptionKey();
      const config = {
        url: 'http://localhost:8080/',
        status: 'active',
        timestamp: Date.now(),
        apiKey: 'secret-api-key',
        sensitiveData: {
          username: 'admin',
          password: 'super-secret-password'
        }
      };
      
      const encrypted = encryptObject(config, key);
      const decrypted = decryptObject(encrypted, key);
      
      expect(decrypted).toEqual(config);
    });

    test('should encrypt and decrypt logs-like array', () => {
      const key = generateEncryptionKey();
      const logs = [
        {
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: 'Initial state',
          data: { userId: 123, action: 'login' }
        },
        {
          timestamp: new Date().toISOString(),
          hypothesisId: 'H2',
          context: 'User action',
          data: { userId: 123, action: 'purchase', amount: 99.99 }
        }
      ];
      
      const encrypted = encryptObject(logs, key);
      const decrypted = decryptObject(encrypted, key);
      
      expect(decrypted).toEqual(logs);
    });
  });
});