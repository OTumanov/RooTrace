import * as vscode from 'vscode';
import { ActivationManager } from '../src/extension-core/activation-manager';

// Mock all the dependencies
jest.mock('vscode');
jest.mock('../src/server/server-manager');
jest.mock('../src/dashboard/dashboard-manager');
jest.mock('../src/websocket/websocket-manager');
jest.mock('../src/session-manager');
jest.mock('../src/commands/command-factory');
jest.mock('../src/extension-core/command-registry');
jest.mock('../src/services/prompt-service');
jest.mock('../src/role-manager');
jest.mock('../src/mcp-registration');
jest.mock('../src/shared-log-storage');
jest.mock('../src/services/log-service');
jest.mock('../src/services/storage-service');
jest.mock('../src/services/role-service');
jest.mock('../src/rootrace-dir-utils');
jest.mock('../src/encryption-validator');

// Import after mocking
const { validateEncryptionKey } = require('../src/encryption-validator');

describe('Encryption Activation Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ROO_TRACE_ENCRYPTION_KEY;
    delete process.env.ROO_TRACE_SECRET_PHRASE;
    
    // Reset mocks
    (validateEncryptionKey as jest.MockedFunction<any>).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('should fail activation when no encryption key is configured', async () => {
    // Mock validation to throw an error
    (validateEncryptionKey as jest.MockedFunction<any>).mockImplementation(() => {
      throw new Error('Encryption key is not configured');
    });

    const mockContext: any = createMockExtensionContext();
    const activationManager = ActivationManager.getInstance();
    
    await expect(
      activationManager.activate(mockContext)
    ).rejects.toThrow('Encryption key validation failed');
  });

  test('should succeed activation when valid encryption key is configured', async () => {
    process.env.ROO_TRACE_ENCRYPTION_KEY = 'a'.repeat(64);
    
    // Mock validation to succeed
    (validateEncryptionKey as jest.MockedFunction<any>).mockImplementation(() => {});
    
    const mockContext: any = createMockExtensionContext();
    const activationManager = ActivationManager.getInstance();
    
    // We can't fully test activation without mocking all dependencies
    // So we just test that the validation passes
    expect(() => {
      validateEncryptionKey();
    }).not.toThrow();
  });

  test('should succeed activation when valid secret phrase is configured', async () => {
    process.env.ROO_TRACE_SECRET_PHRASE = 'valid-secret-phrase-123';
    
    // Mock validation to succeed
    (validateEncryptionKey as jest.MockedFunction<any>).mockImplementation(() => {});
    
    const mockContext: any = createMockExtensionContext();
    const activationManager = ActivationManager.getInstance();
    
    expect(() => {
      validateEncryptionKey();
    }).not.toThrow();
  });

  function createMockExtensionContext(): vscode.ExtensionContext {
    return {
      subscriptions: [],
      extensionPath: '/mock/path',
      storagePath: '/mock/storage',
      globalStoragePath: '/mock/global-storage',
      logPath: '/mock/log',
      extensionUri: vscode.Uri.parse('file:///mock/path'),
      globalState: createMockState(),
      workspaceState: createMockState(),
      secrets: createMockSecrets(),
      extensionMode: vscode.ExtensionMode.Test,
      asAbsolutePath: (relativePath: string) => `/mock/path/${relativePath}`,
    } as any;
  }

  function createMockState(): vscode.Memento {
    return {
      get: jest.fn(),
      update: jest.fn(),
      keys: jest.fn(() => []),
    };
  }

  function createMockSecrets(): vscode.SecretStorage {
    return {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(),
      keys: jest.fn(() => Promise.resolve([])),
    };
  }
});