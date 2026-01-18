declare module '@modelcontextprotocol/sdk' {
  export interface Server {
    listen(options: any): Promise<void>;
    close(): Promise<void>;
    setRequestHandler(method: string, handler: (request: any) => any): void;
  }

  export interface ServerOptions {
    name: string;
    version: string;
    tools: Array<any>;
  }

  export function createServer(options: ServerOptions): Server;
}