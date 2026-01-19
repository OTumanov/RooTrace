/**
 * Jest setup file для моков vscode API
 */

// Мокаем vscode модуль
jest.mock('vscode', () => {
  const mockWorkspaceFolders = [
    {
      uri: {
        fsPath: __dirname + '/temp-test-files'
      },
      name: 'test-workspace'
    }
  ];

  return {
    workspace: {
      workspaceFolders: mockWorkspaceFolders,
      getConfiguration: jest.fn((section?: string) => {
        const config: Record<string, any> = {
          maxLogs: 1000,
          rateLimitMaxRequests: 100,
          rateLimitWindowMs: 60000,
          syntaxCheckTimeout: 10000,
          enableSyntaxValidation: true,
          autoCleanupInactiveClients: true
        };

        return {
          get: jest.fn((key: string, defaultValue?: any) => {
            return config[key] !== undefined ? config[key] : defaultValue;
          })
        };
      }),
      onDidChangeWorkspaceFolders: jest.fn()
    },
    window: {
      createOutputChannel: jest.fn(() => ({
        appendLine: jest.fn(),
        show: jest.fn(),
        clear: jest.fn()
      })),
      showInformationMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      showWarningMessage: jest.fn()
    },
    commands: {
      executeCommand: jest.fn()
    },
    ViewColumn: {
      One: 1,
      Two: 2
    },
    ProgressLocation: {
      Notification: 1
    },
    Range: jest.fn(),
    Position: jest.fn()
  };
}, { virtual: true });
