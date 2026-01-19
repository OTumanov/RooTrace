/**
 * Mock для vscode модуля
 */

const mockWorkspaceFolders = [
  {
    uri: {
      fsPath: process.cwd() + '/tests/temp-test-files'
    },
    name: 'test-workspace'
  }
];

const mockConfig: Record<string, any> = {
  maxLogs: 1000,
  rateLimitMaxRequests: 100,
  rateLimitWindowMs: 60000,
  syntaxCheckTimeout: 10000,
  enableSyntaxValidation: true,
  autoCleanupInactiveClients: true
};

export const workspace = {
  workspaceFolders: mockWorkspaceFolders,
  getConfiguration: jest.fn((section?: string) => {
    return {
      get: jest.fn((key: string, defaultValue?: any) => {
        const fullKey = section ? `${section}.${key}` : key;
        return mockConfig[fullKey] !== undefined ? mockConfig[fullKey] : defaultValue;
      })
    };
  }),
  onDidChangeWorkspaceFolders: jest.fn(),
  findFiles: jest.fn(),
  openTextDocument: jest.fn(),
  applyEdit: jest.fn()
};

export const window = {
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    show: jest.fn(),
    clear: jest.fn()
  })),
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  withProgress: jest.fn()
};

export const commands = {
  executeCommand: jest.fn()
};

export const ViewColumn = {
  One: 1,
  Two: 2
};

export const ProgressLocation = {
  Notification: 1
};

export const Range = jest.fn();
export const Position = jest.fn();

export const extensions = {
  all: []
};

export default {
  workspace,
  window,
  commands,
  ViewColumn,
  ProgressLocation,
  Range,
  Position,
  extensions
};
